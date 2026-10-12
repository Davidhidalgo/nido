#include "nido_github.h"
#include "nido_ota.h"
#include "esp_http_client.h"
#include "esp_crt_bundle.h"
#include "esp_timer.h"
#include <algorithm>
#include <cstring>
#include <ctime>
#include <vector>
namespace nido {
namespace {
constexpr char repository[]="Davidhidalgo/nido";
struct Download {
    esp_http_client_handle_t client=nullptr;std::string redirect;int64_t deadline;int64_t size=-1;
    explicit Download(int64_t end):deadline(end){}
    ~Download(){Close();}
    void Close(){if(client){esp_http_client_close(client);esp_http_client_cleanup(client);client=nullptr;}}
    int Timeout(){return static_cast<int>(std::min<int64_t>(5000,std::max<int64_t>(1,(deadline-esp_timer_get_time())/1000)));}
    static esp_err_t Event(esp_http_client_event_t* e){if(e->event_id==HTTP_EVENT_ON_HEADER&&e->header_key&&e->header_value&&strcasecmp(e->header_key,"Location")==0){auto* self=static_cast<Download*>(e->user_data);if(std::strlen(e->header_value)>2048)return ESP_FAIL;self->redirect=e->header_value;}return ESP_OK;}
    bool Open(std::string url,size_t limit){
        for(int hop=0;hop<4&&esp_timer_get_time()<deadline;++hop){
            if(!GithubUrl(url))return false;
            Close();redirect.clear();
            esp_http_client_config_t config{};config.url=url.c_str();config.crt_bundle_attach=esp_crt_bundle_attach;config.timeout_ms=Timeout();config.disable_auto_redirect=true;config.event_handler=Event;config.user_data=this;config.buffer_size=4096;config.buffer_size_tx=4096; // GitHub asset redirects carry long signed query strings.
            client=esp_http_client_init(&config);if(!client)return false;
            esp_http_client_set_header(client,"User-Agent","Nido-Note4-OTA");esp_http_client_set_header(client,"Accept","application/vnd.github+json");
            if(esp_http_client_open(client,0)!=ESP_OK)return false;
            esp_http_client_set_timeout_ms(client,Timeout());size=esp_http_client_fetch_headers(client);
            const int status=esp_http_client_get_status_code(client);
            if(status==301||status==302||status==303||status==307||status==308){url=redirect;continue;}
            return status==200&&size>=0&&size<=static_cast<int64_t>(limit)&&esp_timer_get_time()<deadline;
        }return false;
    }
    int Read(void* bytes,size_t count){if(esp_timer_get_time()>=deadline)return -1;esp_http_client_set_timeout_ms(client,Timeout());return esp_http_client_read(client,static_cast<char*>(bytes),count);}
    bool Exact(void* bytes,size_t count){size_t used=0;while(used<count){const int n=Read(static_cast<char*>(bytes)+used,count-used);if(n<=0)return false;used+=n;}return true;}
};
}
bool GithubLatest(const char* current,GithubRelease& release,int64_t deadline){
    // Never bypass TLS date verification if the RTC has not yet been synchronized.
    if(std::time(nullptr)<1704067200)return false;
    Download download(deadline);if(!download.Open(std::string("https://api.github.com/repos/")+repository+"/releases/latest",65536))return false;
    std::string body;char chunk[2048];for(;;){const int n=download.Read(chunk,sizeof(chunk));if(n<0)return false;if(!n)break;if(body.size()+n>65536)return false;body.append(chunk,n);}
    if(!esp_http_client_is_complete_data_received(download.client))return false;
    auto* root=cJSON_ParseWithLength(body.data(),body.size());const bool ok=root&&GithubParseRelease(root,repository,current,release);cJSON_Delete(root);return ok;
}
bool GithubInstall(const GithubRelease& release){
    Download download(esp_timer_get_time()+180000000LL);if(!GithubUrl(release.url)||!download.Open(release.url,4195856)||(download.size>0&&download.size!=static_cast<int64_t>(release.size)))return false;
    unsigned char header[16];if(!download.Exact(header,sizeof(header))||std::memcmp(header,"NIDOOTA1",8))return false;
    auto number=[&](int i){return static_cast<uint32_t>(header[i])|(static_cast<uint32_t>(header[i+1])<<8)|(static_cast<uint32_t>(header[i+2])<<16)|(static_cast<uint32_t>(header[i+3])<<24);};
    const size_t m=number(8),s=number(12);if(!m||m>1024||s!=512||release.size<=16+m+s)return false;
    std::string manifest(m,'\0'),signature(s,'\0');if(!download.Exact(manifest.data(),m)||!download.Exact(signature.data(),s))return false;
    auto* root=cJSON_ParseWithLength(manifest.data(),manifest.size());const auto* version=cJSON_GetObjectItemCaseSensitive(root,"version");const bool matches=cJSON_IsString(version)&&release.version==version->valuestring;cJSON_Delete(root);if(!matches)return false;
    OtaWriter writer;if(!writer.Begin(manifest,signature)||writer.version!=release.version||writer.remaining()!=release.size-16-m-s)return false;
    unsigned char chunk[4096];while(writer.remaining()){const size_t n=std::min(writer.remaining(),sizeof(chunk));if(!download.Exact(chunk,n)||!writer.Write(chunk,n))return false;}
    char extra;if(download.Read(&extra,1)!=0||!esp_http_client_is_complete_data_received(download.client))return false;
    return writer.Finish();
}
}
