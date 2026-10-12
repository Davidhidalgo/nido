#include "nido_config.h"
#include <cstdio>
#include <cstring>
#include <memory>
namespace nido {
std::string MaintenanceSsid(const uint8_t (&mac)[6]) {
    char name[12];std::snprintf(name,sizeof(name),"Nido-%02X%02X%02X",mac[3],mac[4],mac[5]);return name;
}
bool HexString(const char* value,size_t length) {
    if(!value || std::strlen(value)!=length)return false;
    for(size_t i=0;i<length;++i)if(!((value[i]>='0'&&value[i]<='9')||(value[i]>='a'&&value[i]<='f')))return false;
    return true;
}
bool LocalEndpoint(const char* value) {
    if(!value || std::strlen(value)>160)return false;
    unsigned a,b,c,d,port=443;int used=0;
    if(std::sscanf(value,"https://%u.%u.%u.%u%n",&a,&b,&c,&d,&used)!=4 || a>255 || b>255 || c>255 || d>255)return false;
    if(!(a==10 || (a==192 && b==168) || (a==172 && b>=16 && b<=31)))return false;
    if(value[used]==':'){int tail=0;if(std::sscanf(value+used,":%u%n",&port,&tail)!=1 || port==0 || port>65535)return false;used+=tail;}
    return value[used]=='\0';
}
namespace {
bool Get(const cJSON* root,const char* key,std::string& out,size_t limit,bool empty=false) {
    auto* value=cJSON_GetObjectItemCaseSensitive(root,key);
    if(!cJSON_IsString(value) || !value->valuestring || std::strlen(value->valuestring)>limit || (!empty && !*value->valuestring))return false;
    out=value->valuestring;return true;
}
}
bool ParseRuntimeConfig(const cJSON* root,RuntimeConfig& result,bool pairing) {
    RuntimeConfig next;
    const auto* schema=cJSON_GetObjectItemCaseSensitive(root,"schema");
    if(!cJSON_IsNumber(schema) || schema->valuedouble!=1 || !Get(root,"ssid",next.ssid,32) || !Get(root,"password",next.password,63,true) ||
      (!next.password.empty() && next.password.size()<8) || !Get(root,"endpoint",next.endpoint,160,true) ||
      !Get(root,"certificate",next.certificate,4096,true) || !Get(root,"token",next.token,64,true) || !Get(root,"deviceId",next.device_id,64,true))return false;
    const bool wifi_only=next.endpoint.empty() && next.certificate.empty() && next.token.empty() && next.device_id.empty();
    if(wifi_only){if(pairing)return false;result=std::move(next);return true;}
    if(!LocalEndpoint(next.endpoint.c_str()) || next.certificate.find("-----BEGIN CERTIFICATE-----")!=0 ||
       !HexString(next.token.c_str(),64) || next.device_id.empty())return false;
    for(char c:next.device_id)if(!((c>='a'&&c<='z')||(c>='A'&&c<='Z')||(c>='0'&&c<='9')||c=='-'||c=='_'))return false;
    if(pairing) {
        const auto* issued=cJSON_GetObjectItemCaseSensitive(root,"issuedAt");const auto* expires=cJSON_GetObjectItemCaseSensitive(root,"expiresAt");
        if(!Get(root,"grant",next.grant,64)||!HexString(next.grant.c_str(),64)||!cJSON_IsNumber(issued)||!cJSON_IsNumber(expires)||
          issued->valuedouble<1700000000 || expires->valuedouble<=issued->valuedouble || expires->valuedouble-issued->valuedouble>901)return false;
        next.issued_at=static_cast<int64_t>(issued->valuedouble);next.expires_at=static_cast<int64_t>(expires->valuedouble);
    }
    result=std::move(next);return true;
}
std::string ConfigJson(const RuntimeConfig& c) {
    cJSON* root=cJSON_CreateObject();if(!root)return {};
    cJSON_AddNumberToObject(root,"schema",1);cJSON_AddStringToObject(root,"ssid",c.ssid.c_str());cJSON_AddStringToObject(root,"password",c.password.c_str());
    cJSON_AddStringToObject(root,"endpoint",c.endpoint.c_str());cJSON_AddStringToObject(root,"certificate",c.certificate.c_str());cJSON_AddStringToObject(root,"token",c.token.c_str());cJSON_AddStringToObject(root,"deviceId",c.device_id.c_str());
    if(!c.grant.empty()){cJSON_AddStringToObject(root,"grant",c.grant.c_str());cJSON_AddNumberToObject(root,"issuedAt",c.issued_at);cJSON_AddNumberToObject(root,"expiresAt",c.expires_at);}
    char* raw=cJSON_PrintUnformatted(root);std::string out=raw ? raw : "";cJSON_free(raw);cJSON_Delete(root);return out;
}
}
