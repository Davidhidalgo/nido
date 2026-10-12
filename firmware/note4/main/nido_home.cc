#include "nido_home.h"
#include "cJSON.h"
#include <cstring>
#include <cstdio>
#include <memory>
#include <new>
#include <cmath>
namespace nido {
namespace {
bool String(const cJSON* p,const char* key,char* out,size_t size) {
    const auto* v=cJSON_GetObjectItemCaseSensitive(p,key);
    if(!cJSON_IsString(v)||std::strlen(v->valuestring)>=size)return false;
    std::strcpy(out,v->valuestring);return true;
}
}
bool ValidHomeDate(const char* date) {
    if(!date||std::strlen(date)!=10)return false;
    for(int i=0;i<10;++i)if(i==4||i==7){if(date[i]!='-')return false;}else if(date[i]<'0'||date[i]>'9')return false;
    int y,m,d;if(std::sscanf(date,"%d-%d-%d",&y,&m,&d)!=3||y<1970||y>2200||m<1||m>12)return false;
    const int lengths[]={31,28,31,30,31,30,31,31,30,31,30,31};
    const int max=lengths[m-1]+(m==2 && y%4==0 && (y%100!=0||y%400==0));
    return d>=1&&d<=max;
}
bool ParseHome(const cJSON* json,HomeSnapshot& snapshot) {
    std::unique_ptr<HomeSnapshot> next(new(std::nothrow) HomeSnapshot{});if(!next)return false;
    const auto* days=cJSON_GetObjectItemCaseSensitive(json,"days");
    const auto* stamp=cJSON_GetObjectItemCaseSensitive(json,"serverTime");
    const auto* demo=cJSON_GetObjectItemCaseSensitive(json,"demo");
    if(!String(json,"today",next->today,sizeof(next->today))||!ValidHomeDate(next->today)||
       !cJSON_IsNumber(stamp)||!std::isfinite(stamp->valuedouble)||stamp->valuedouble<1700000000||stamp->valuedouble>2200000000||
       !cJSON_IsBool(demo)||!cJSON_IsArray(days)||cJSON_GetArraySize(days)!=kHomeDays)return false;
    next->update_available=cJSON_IsTrue(cJSON_GetObjectItemCaseSensitive(json,"updateAvailable"));
    next->server_time=static_cast<int64_t>(stamp->valuedouble);next->demo=cJSON_IsTrue(demo);next->day_count=kHomeDays;
    for(int i=0;i<kHomeDays;++i) {
        auto& day=next->days[i];const auto* item=cJSON_GetArrayItem(days,i);
        const auto* events=cJSON_GetObjectItemCaseSensitive(item,"events");
        const auto* more=cJSON_GetObjectItemCaseSensitive(item,"more");
        if(!String(item,"date",day.date,sizeof(day.date))||!ValidHomeDate(day.date)||
           (i && std::strcmp(next->days[i-1].date,day.date)>=0)||
           !String(item,"label",day.label,sizeof(day.label))||!String(item,"lunch",day.lunch,sizeof(day.lunch))||
           !String(item,"dinner",day.dinner,sizeof(day.dinner))||!cJSON_IsArray(events)||cJSON_GetArraySize(events)>6||
           !cJSON_IsNumber(more)||!std::isfinite(more->valuedouble)||more->valuedouble<0||more->valuedouble>100000||std::floor(more->valuedouble)!=more->valuedouble)return false;
        const auto* lunch_past=cJSON_GetObjectItemCaseSensitive(item,"lunchPast");
        const auto* dinner_past=cJSON_GetObjectItemCaseSensitive(item,"dinnerPast");
        if((lunch_past && !cJSON_IsBool(lunch_past)) || (dinner_past && !cJSON_IsBool(dinner_past)))return false;
        day.lunch_past=cJSON_IsTrue(lunch_past);day.dinner_past=cJSON_IsTrue(dinner_past);
        day.available=true;day.more=more->valueint;day.event_count=cJSON_GetArraySize(events);
        for(int j=0;j<day.event_count;++j) {
            auto& event=day.events[j];const auto* e=cJSON_GetArrayItem(events,j);
            const auto* all=cJSON_GetObjectItemCaseSensitive(e,"allDay");
            if(!String(e,"summary",event.summary,sizeof(event.summary))||!String(e,"time",event.time,sizeof(event.time))||!cJSON_IsBool(all))return false;
            event.all_day=cJSON_IsTrue(all);
            // Optional metadata preserves compatibility with an older bridge.
            if(cJSON_GetObjectItemCaseSensitive(e,"calendarLabel") &&
               !String(e,"calendarLabel",event.calendar_label,sizeof(event.calendar_label)))return false;
            if(cJSON_GetObjectItemCaseSensitive(e,"key") &&
               !String(e,"key",event.key,sizeof(event.key)))return false;
            if(cJSON_GetObjectItemCaseSensitive(e,"startDate") &&
               (!String(e,"startDate",event.start_date,sizeof(event.start_date)) || !ValidHomeDate(event.start_date)))return false;
            if(cJSON_GetObjectItemCaseSensitive(e,"endDate") &&
               (!String(e,"endDate",event.end_date,sizeof(event.end_date)) || !ValidHomeDate(event.end_date)))return false;
            if(*event.start_date && *event.end_date && std::strcmp(event.start_date,event.end_date)>0)return false;
        }
    }
    snapshot=*next;return true;
}
const HomeDay* FindHomeDay(const HomeSnapshot& snapshot,const char* date) {
    for(int i=0;i<snapshot.day_count;++i)if(std::strcmp(snapshot.days[i].date,date)==0)return &snapshot.days[i];
    return nullptr;
}
}
