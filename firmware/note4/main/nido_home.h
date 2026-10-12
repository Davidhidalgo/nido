#pragma once
#include <cstdint>
struct cJSON;
namespace nido {
constexpr int kHomeDays = 15;
struct HomeEvent { char summary[129]; char time[32]; bool all_day; char key[33]; char start_date[11]; char end_date[11]; char calendar_label[65]; };
struct HomeDay {
    bool available; char date[11]; char label[96]; char lunch[161]; char dinner[161];
    bool lunch_past; bool dinner_past;
    HomeEvent events[6]; int event_count; int more;
};
struct HomeSnapshot {
    char today[11]; int64_t server_time; bool demo; int day_count; bool update_available;
    HomeDay days[kHomeDays];
};
bool ValidHomeDate(const char* date);
bool ParseHome(const cJSON* json, HomeSnapshot& snapshot);
const HomeDay* FindHomeDay(const HomeSnapshot& snapshot, const char* date);
}
