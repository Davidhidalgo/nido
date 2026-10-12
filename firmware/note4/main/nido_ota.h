#pragma once
#include <string>
#include <cstddef>
#include "esp_ota_ops.h"
namespace nido {
struct OtaWriter {
    OtaWriter()=default;
    OtaWriter(const OtaWriter&)=delete;
    OtaWriter& operator=(const OtaWriter&)=delete;
    ~OtaWriter();
    bool Begin(const std::string& manifest,const std::string& signature);
    bool Write(const void* bytes,size_t size);
    bool Finish();
    size_t remaining() const {return expected_-written_;}
    std::string version;
private:
    esp_ota_handle_t handle_=0;
    const esp_partition_t* partition_=nullptr;
    size_t expected_=0,written_=0;
    std::string sha256_;
    unsigned char first_[16]={};size_t first_size_=0;
};
void ConfirmFirmware();
void FirmwareBootGuard();
const char* FirmwareBootState(const char* expected_version=nullptr);
}
