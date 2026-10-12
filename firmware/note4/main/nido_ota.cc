#include "nido_ota.h"
#include "nido_config.h"
#include "nido_ota_key.h"
#include "cJSON.h"
#include "mbedtls/pk.h"
#include "mbedtls/sha256.h"
#include "esp_app_desc.h"
#include "esp_timer.h"
#include "esp_partition.h"
#include <algorithm>
#include <cstring>
#include <cstdio>
#include <vector>
namespace nido {
namespace {
std::string Field(cJSON* root,const char* name) {auto* v=cJSON_GetObjectItemCaseSensitive(root,name);return cJSON_IsString(v) ? v->valuestring : "";}
}
OtaWriter::~OtaWriter(){if(handle_)esp_ota_abort(handle_);}
bool OtaWriter::Begin(const std::string& manifest,const std::string& signature) {
    if(handle_ || manifest.size()>1024 || !HexString(signature.c_str(),512) || !*kOtaPublicKey)return false;
    unsigned char digest[32],sig[256];mbedtls_sha256(reinterpret_cast<const unsigned char*>(manifest.data()),manifest.size(),digest,0);
    for(size_t i=0;i<256;++i){unsigned value=0;std::sscanf(signature.c_str()+i*2,"%2x",&value);sig[i]=value;}
    mbedtls_pk_context key;mbedtls_pk_init(&key);
    const bool valid=mbedtls_pk_parse_public_key(&key,reinterpret_cast<const unsigned char*>(kOtaPublicKey),std::strlen(kOtaPublicKey)+1)==0 &&
      mbedtls_pk_get_type(&key)==MBEDTLS_PK_RSA && mbedtls_pk_get_bitlen(&key)==2048 && mbedtls_pk_verify(&key,MBEDTLS_MD_SHA256,digest,sizeof(digest),sig,sizeof(sig))==0;
    mbedtls_pk_free(&key);if(!valid)return false;
    cJSON* root=cJSON_Parse(manifest.c_str());if(!root)return false;
    auto* size=cJSON_GetObjectItemCaseSensitive(root,"size");auto* schema=cJSON_GetObjectItemCaseSensitive(root,"configVersion");
    version=Field(root,"version");sha256_=Field(root,"sha256");
    const bool fields=Field(root,"board")=="note4-mono-v1" && cJSON_IsNumber(schema) && schema->valuedouble==1 && cJSON_IsNumber(size) &&
      size->valuedouble>=256 && size->valuedouble<=4194304 && size->valuedouble==static_cast<size_t>(size->valuedouble) && !version.empty() && version.size()<=31 && HexString(sha256_.c_str(),64);
    if(fields)expected_=static_cast<size_t>(size->valuedouble);
    cJSON_Delete(root);if(!fields)return false;
    partition_=esp_ota_get_next_update_partition(nullptr);
    if(!partition_ || expected_>partition_->size)return false;
    return esp_ota_begin(partition_,expected_,&handle_)==ESP_OK;
}
bool OtaWriter::Write(const void* bytes,size_t size) {
    if(!handle_ || size>remaining())return false;
    const size_t copy=std::min(size,sizeof(first_)-first_size_);if(copy){std::memcpy(first_+first_size_,bytes,copy);first_size_+=copy;}
    if(first_size_>=14 && (first_[0]!=0xe9 || first_[12]!=9 || first_[13]!=0))return false;
    if(esp_ota_write(handle_,bytes,size)!=ESP_OK)return false;
    written_+=size;return true;
}
bool OtaWriter::Finish() {
    if(!handle_ || written_!=expected_)return false;
    // Hash exact application bytes; esp_partition_get_sha256 hashes a different image extent.
    mbedtls_sha256_context hash;mbedtls_sha256_init(&hash);mbedtls_sha256_starts(&hash,0);
    unsigned char buffer[4096],digest[32];bool valid=true;
    for(size_t offset=0;offset<expected_;offset+=sizeof(buffer)){const size_t size=std::min(sizeof(buffer),expected_-offset);if(esp_partition_read(partition_,offset,buffer,size)!=ESP_OK){valid=false;break;}mbedtls_sha256_update(&hash,buffer,size);}
    mbedtls_sha256_finish(&hash,digest);mbedtls_sha256_free(&hash);
    char hex[65]={};for(int i=0;i<32;++i)std::snprintf(hex+i*2,3,"%02x",digest[i]);
    if(!valid || sha256_!=hex)return false;
    esp_app_desc_t description{};
    if(esp_ota_get_partition_description(partition_,&description)!=ESP_OK || !std::memchr(description.version,0,sizeof(description.version)) || !std::memchr(description.project_name,0,sizeof(description.project_name)) || version!=description.version || std::strcmp(description.project_name,"nido_note4")!=0)return false;
    const auto handle=handle_;handle_=0;
    if(esp_ota_end(handle)!=ESP_OK)return false;
    return esp_ota_set_boot_partition(partition_)==ESP_OK;
}
void ConfirmFirmware() {
    esp_ota_img_states_t state;
    const auto* running=esp_ota_get_running_partition();
    if(running && esp_ota_get_state_partition(running,&state)==ESP_OK && state==ESP_OTA_IMG_PENDING_VERIFY)esp_ota_mark_app_valid_cancel_rollback();
}
void FirmwareBootGuard() {
    static int64_t began=esp_timer_get_time();esp_ota_img_states_t state;
    const auto* running=esp_ota_get_running_partition();
    if(running && esp_ota_get_state_partition(running,&state)==ESP_OK && state==ESP_OTA_IMG_PENDING_VERIFY && esp_timer_get_time()-began>30000000LL)
        esp_ota_mark_app_invalid_rollback_and_reboot();
}
const char* FirmwareBootState(const char* expected_version){
    if(!expected_version || !*expected_version)return "valid";
    for(auto subtype : {ESP_PARTITION_SUBTYPE_APP_OTA_0,ESP_PARTITION_SUBTYPE_APP_OTA_1}){
      const auto* p=esp_partition_find_first(ESP_PARTITION_TYPE_APP,subtype,nullptr);esp_ota_img_states_t state;esp_app_desc_t description{};
      if(p && esp_ota_get_state_partition(p,&state)==ESP_OK && state==ESP_OTA_IMG_ABORTED && esp_ota_get_partition_description(p,&description)==ESP_OK &&
        std::memchr(description.version,0,sizeof(description.version)) && std::strcmp(description.version,expected_version)==0)return "rollback";
    }
    return "valid";
}
}
