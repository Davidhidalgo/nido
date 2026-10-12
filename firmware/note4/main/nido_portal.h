#pragma once
#include <cstddef>
#include <cstdint>
#include <cstring>
#ifdef ESP_PLATFORM
#include "lwip/sockets.h"
#else
#include <sys/socket.h>
#include <netinet/in.h>
#endif
namespace nido {
inline bool MaintenanceAddress(const sockaddr_storage& address, socklen_t size) {
    const uint8_t ap[4]={192,168,4,1};
    if(address.ss_family==AF_INET && size>=sizeof(sockaddr_in)) {
        sockaddr_in v4{};std::memcpy(&v4,&address,sizeof(v4));
        return std::memcmp(&v4.sin_addr,ap,4)==0;
    }
    if(address.ss_family==AF_INET6 && size>=sizeof(sockaddr_in6)) {
        sockaddr_in6 v6{};std::memcpy(&v6,&address,sizeof(v6));
        const uint8_t mapped[12]={0,0,0,0,0,0,0,0,0,0,255,255};
        return std::memcmp(&v6.sin6_addr,mapped,12)==0 &&
            std::memcmp(reinterpret_cast<const uint8_t*>(&v6.sin6_addr)+12,ap,4)==0;
    }
    return false;
}
// One uncompressed IN question, bounded to classic DNS's 512-byte datagram.
// Only A receives an answer; AAAA receives NODATA so clients try IPv4.
inline size_t PortalDns(uint8_t* packet,size_t size,size_t capacity) {
    if(size<17 || size>512 || capacity<size || (packet[2]&0xf8) || packet[3] ||
       packet[4]!=0 || packet[5]!=1 || packet[6] || packet[7] || packet[8] || packet[9])return 0;
    size_t pos=12,name_size=0;
    while(pos<size && packet[pos]) {
        const size_t label=packet[pos++];
        if(label>63 || pos+label>=size || (name_size+=label+1)>253)return 0;
        pos+=label;
    }
    if(pos+5>size)return 0;
    ++pos;const unsigned type=(packet[pos]<<8)|packet[pos+1];
    if(packet[pos+2]!=0 || packet[pos+3]!=1)return 0;
    pos+=4;
    if(type==1 && pos+16>capacity)return 0;
    packet[2]=static_cast<uint8_t>(0x80|(packet[2]&1));packet[3]=0;
    packet[6]=0;packet[7]=type==1 ? 1 : 0;
    packet[10]=packet[11]=0;
    if(type==1){const uint8_t answer[16]={0xc0,0x0c,0,1,0,1,0,0,0,0,0,4,192,168,4,1};std::memcpy(packet+pos,answer,16);pos+=16;}
    return pos;
}
}
