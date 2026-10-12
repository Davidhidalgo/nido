#include "nido_card.h"
#include "cJSON.h"
#include <cstring>
#include <memory>
#include <new>

namespace nido {
namespace {
bool String(const cJSON* parent, const char* key, char* target, size_t size, bool optional=false) {
    const cJSON* value=cJSON_GetObjectItemCaseSensitive(parent,key);
    if (!value && optional) return true;
    if (!cJSON_IsString(value) || std::strlen(value->valuestring)>=size) return false;
    std::strcpy(target,value->valuestring);
    return true;
}
bool Is(const char* value, const char* expected) { return std::strcmp(value,expected)==0; }
}
bool ParseDeviceCard(const cJSON* json, DeviceCard& card) {
    // Keep the growing view payload off the ESP main task stack.
    std::unique_ptr<DeviceCard> storage(new(std::nothrow) DeviceCard{});
    if (!storage) return false;
    auto& next=*storage;
    const auto* view=cJSON_GetObjectItemCaseSensitive(json,"view");
    bool valid=String(json,"cardId",next.id,sizeof(next.id)) &&
        String(json,"title",next.title,sizeof(next.title)) &&
        String(json,"status",next.status,sizeof(next.status)) &&
        String(view,"type",next.type,sizeof(next.type));
    if (!valid) return false;
    if (!Is(next.status,"progress") && !Is(next.status,"question") && !Is(next.status,"done") &&
        !Is(next.status,"partial") && !Is(next.status,"error")) return false;
    if (Is(next.type,"event")) {
        const auto* all_day=cJSON_GetObjectItemCaseSensitive(view,"allDay");
        const auto* estimated=cJSON_GetObjectItemCaseSensitive(view,"durationEstimated");
        valid=String(view,"summary",next.summary,sizeof(next.summary)) &&
            String(view,"date",next.date,sizeof(next.date)) && String(view,"endDate",next.end_date,sizeof(next.end_date)) &&
            String(view,"startTime",next.start_time,sizeof(next.start_time)) && String(view,"endTime",next.end_time,sizeof(next.end_time)) &&
            String(view,"location",next.location,sizeof(next.location),true) && cJSON_IsBool(all_day) && cJSON_IsBool(estimated);
        next.all_day=cJSON_IsTrue(all_day); next.duration_estimated=cJSON_IsTrue(estimated);
    } else if (Is(next.type,"meal_change") || Is(next.type,"compare")) {
        valid=String(view,"before",next.before,sizeof(next.before)) && String(view,"after",next.after,sizeof(next.after));
        if (Is(next.type,"meal_change")) valid=valid && String(view,"date",next.date,sizeof(next.date)) && String(view,"meal",next.meal,sizeof(next.meal));
        else valid=valid && String(view,"beforeLabel",next.before_label,sizeof(next.before_label)) && String(view,"afterLabel",next.after_label,sizeof(next.after_label));
    } else if (Is(next.type,"list") || Is(next.type,"facts")) {
        const auto* items=cJSON_GetObjectItemCaseSensitive(view,"items");
        next.row_count=cJSON_GetArraySize(items);
        valid=cJSON_IsArray(items) && next.row_count>=1 && next.row_count<=3;
        for (int i=0;valid && i<next.row_count;++i) {
            const auto* item=cJSON_GetArrayItem(items,i);
            valid=String(item,"label",next.rows[i].label,sizeof(next.rows[i].label)) &&
                String(item,Is(next.type,"list") ? "detail" : "value",next.rows[i].value,sizeof(next.rows[i].value),Is(next.type,"list"));
        }
    } else if (Is(next.type,"highlight")) {
        valid=String(view,"value",next.value,sizeof(next.value)) && String(view,"caption",next.caption,sizeof(next.caption)) &&
            String(view,"body",next.body,sizeof(next.body),true);
    } else if (Is(next.type,"text") || Is(next.type,"binary")) {
        valid=String(view,"body",next.body,sizeof(next.body));
        if (Is(next.type,"binary")) {
            const auto* options=cJSON_GetObjectItemCaseSensitive(view,"options");
            valid=valid && cJSON_IsArray(options) && cJSON_GetArraySize(options)==2 &&
                String(cJSON_GetArrayItem(options,0),"label",next.labels[0],sizeof(next.labels[0])) &&
                String(cJSON_GetArrayItem(options,1),"label",next.labels[1],sizeof(next.labels[1]));
        }
    } else return false;
    if (Is(next.type,"binary") != Is(next.status,"question") &&
        !(Is(next.type,"text") && Is(next.status,"question"))) valid=false;
    if (valid) card=next;
    return valid;
}
}
