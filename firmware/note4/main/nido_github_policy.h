#pragma once
#include <string>
#include <cstdint>
#include "cJSON.h"
namespace nido {
struct GithubRelease {std::string version,url;size_t size=0;};
inline bool GithubVersion(const std::string& text,uint32_t (&parts)[3]) {
    if(text.size()>31||text.compare(0,9,"nido-ota-")!=0)return false;
    size_t p=9;for(int i=0;i<3;++i){parts[i]=0;if(p==text.size())return false;
        const size_t start=p;while(p<text.size()&&text[p]>='0'&&text[p]<='9'){if(parts[i]>1000000)return false;parts[i]=parts[i]*10+text[p++]-'0';}
        if(p==start||(p-start>1&&text[start]=='0'))return false;
        if(p==text.size())return i>=1;
        if(i==2||text[p++]!='.')return false;
    }return p==text.size();
}
inline bool GithubNewer(const std::string& next,const std::string& current){uint32_t a[3]={},b[3]={};if(!GithubVersion(next,a)||!GithubVersion(current,b))return false;for(int i=0;i<3;++i)if(a[i]!=b[i])return a[i]>b[i];return false;}
inline bool GithubUrl(const std::string& url){
    if(url.size()>2048||url.find_first_of("\r\n\\ ")!=std::string::npos||url.compare(0,8,"https://")!=0)return false;
    const auto end=url.find('/',8);if(end==std::string::npos)return false;
    const auto host=url.substr(8,end-8);return host=="api.github.com"||host=="github.com"||host=="release-assets.githubusercontent.com"||host=="objects.githubusercontent.com";
}
inline bool GithubParseRelease(const cJSON* root,const std::string& repository,const std::string& current,GithubRelease& out){
    const auto* tag=cJSON_GetObjectItemCaseSensitive(root,"tag_name");const auto* assets=cJSON_GetObjectItemCaseSensitive(root,"assets");
    if(!cJSON_IsFalse(cJSON_GetObjectItemCaseSensitive(root,"draft"))||!cJSON_IsFalse(cJSON_GetObjectItemCaseSensitive(root,"prerelease"))||!cJSON_IsString(tag)||!GithubNewer(tag->valuestring,current)||!cJSON_IsArray(assets))return false;
    GithubRelease candidate;int count=0;const cJSON* a=nullptr;
    cJSON_ArrayForEach(a,assets){const auto* name=cJSON_GetObjectItemCaseSensitive(a,"name");if(!cJSON_IsString(name))continue;const std::string n=name->valuestring;
        if(n.size()<8||n.substr(n.size()-8)!=".nidoota")continue;
        ++count;
        const auto* url=cJSON_GetObjectItemCaseSensitive(a,"browser_download_url");const auto* size=cJSON_GetObjectItemCaseSensitive(a,"size");const auto* state=cJSON_GetObjectItemCaseSensitive(a,"state");
        if(!cJSON_IsString(url)||!cJSON_IsString(state)||std::string(state->valuestring)!="uploaded"||!cJSON_IsNumber(size)||size->valuedouble<816||size->valuedouble>4195856||size->valuedouble!=static_cast<size_t>(size->valuedouble))return false;
        const std::string prefix="https://github.com/"+repository+"/releases/download/"+tag->valuestring+"/";
        if(!GithubUrl(url->valuestring)||std::string(url->valuestring).compare(0,prefix.size(),prefix)!=0)return false;
        candidate={tag->valuestring,url->valuestring,static_cast<size_t>(size->valuedouble)};
    }if(count!=1)return false;out=candidate;return true;
}
}
