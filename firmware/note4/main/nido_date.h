#pragma once
#include <cstdint>
#include <ctime>
namespace nido {
// UTC civil-date arithmetic, independent of libc extensions and local DST.
// A day of 0 or month-length + 1 is intentional when navigating across months.
inline int64_t CivilDays(int year,int month,int day) {
    year-=month<=2;
    const int era=(year>=0 ? year : year-399)/400;
    const int yoe=year-era*400;
    const int doy=(153*(month+(month>2 ? -3 : 9))+2)/5+day-1;
    const int doe=yoe*365+yoe/4-yoe/100+doy;
    return static_cast<int64_t>(era)*146097+doe-719468;
}
inline time_t UtcSeconds(const tm& date) {
    return static_cast<time_t>(CivilDays(date.tm_year+1900,date.tm_mon+1,date.tm_mday)*86400+
        date.tm_hour*3600+date.tm_min*60+date.tm_sec);
}
}
