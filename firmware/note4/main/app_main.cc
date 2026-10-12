// Nido NOTE4 voice client: radio only during turns, deep sleep between inputs.
#include <algorithm>
#include <cstdio>
#include <cstring>
#include <vector>
#include <deque>
#include <atomic>
#include <new>
#include <memory>
#include <cstdlib>
#include <sys/time.h>

#include "audio_codec.h"
#include "nido_sounds.h"
#include "driver/rtc_io.h"
#include "esp_attr.h"
#include "esp_heap_caps.h"
#include "esp_intr_alloc.h"
#include "esp_log.h"
#include "esp_sleep.h"
#include "esp_system.h"
#include "esp_timer.h"
#include "freertos/FreeRTOS.h"
#include "freertos/queue.h"
#include "freertos/task.h"
#include "nido_power_policy.h"
#include "nido_screens.h"
#include "nido_device.h"
#include "nido_config.h"
#include "nido_ui.h"
#include "nido_date.h"
#include "rtc_pcf8563.h"
#include "sdkconfig.h"
#include "zectrix_board.h"
#include "zectrix_board_config.h"
#include "zectrix_epd.h"

namespace {
constexpr char kTag[] = "nido_note4";
constexpr uint32_t kMagic = 0x4e49444f;
constexpr int kRate = 16000;
constexpr int kChunk = 1600;
RTC_DATA_ATTR uint32_t g_magic;
RTC_DATA_ATTR uint32_t g_boots;
RTC_DATA_ATTR uint32_t g_turns;
RTC_DATA_ATTR bool g_rtc_test_pending;
RTC_DATA_ATTR bool g_rtc_test_armed;
RTC_DATA_ATTR uint32_t g_recovery_seconds;
RTC_DATA_ATTR uint32_t g_rtc_probe_result;
RTC_DATA_ATTR int64_t g_session_expires_at;

ZectrixBoard g_board;
HearthCanvas g_canvas;
HearthCanvas g_previous;
zectrix_epd_handle_t g_panel = nullptr;
bool g_have_frame = false;
QueueHandle_t g_audio_events;
nido::UiFlow g_flow;
nido::BootDisplay g_boot_display;
bool g_update_failed=false;
bool g_accept_next_press = false;
char g_question_turn[37] = {};
char g_question_card[65] = {};
volatile bool g_catching_buttons = false;
volatile int g_button_latched = 0;
char g_button_card[65] = {};
bool g_low_battery = false;
nido::HomeSnapshot g_home = {};
HearthCanvas g_day_canvas;
nido::DeviceCard g_modal_card = {};
char g_selected_date[11] = {};
int64_t g_next_sync_us = 0;
bool g_home_failed = false;
bool g_sync_active = false;
bool g_pending_today = false;
bool g_pending_dismiss = false;
nido::HomeDay g_placeholder = {};
char g_today[11] = {};
void LocalToday() {
    const time_t now=time(nullptr);
    if(now>1700000000){tm local{};localtime_r(&now,&local);std::strftime(g_today,sizeof(g_today),"%Y-%m-%d",&local);}
    else std::strcpy(g_today,g_home.today);
}

QueueHandle_t g_home_events;
struct HomeRequest {
    nido::HomeSnapshot snapshot = {};
    char anchor[11] = {};
    bool dismiss = false;
    bool today = false;
    bool ok = false;
};
void DevicePaint(const nido::DeviceCard& card);
void PlaySound(nido::Sound sound);
bool g_feedback_played=false;
std::atomic<bool> g_abort_audio{false};
bool g_request_maintenance=false;
bool g_check_update=false;
QueueHandle_t g_network_events=nullptr;
bool g_network_active=false;
std::atomic<int> g_cancel_network{0};
struct NetworkEvent;
struct NetworkJob { int16_t* pcm=nullptr;size_t samples=0;bool answer=false,upper=false;char turn[37]={},card[65]={};NetworkEvent* completion=nullptr; };
struct NetworkEvent { bool done=false;nido::DeviceCard card={};nido::DeviceResult result={}; };
NetworkEvent* AllocateNetworkEvent() {
    // Two full cards exceed 12 KB; never consume the internal task-stack pool.
    void* storage=heap_caps_malloc(sizeof(NetworkEvent),MALLOC_CAP_SPIRAM|MALLOC_CAP_8BIT);
    return storage ? new(storage) NetworkEvent{} : nullptr;
}
void FreeNetworkEvent(NetworkEvent* event) {event->~NetworkEvent();heap_caps_free(event);}
std::deque<NetworkJob*> g_network_jobs;
void StartNextNetwork();
void DrawCurrent();
void SynchronizeClock(int64_t timestamp) {
    if(!timestamp || !g_board.rtc())return;
    time_t stamp=static_cast<time_t>(timestamp);tm utc{};gmtime_r(&stamp,&utc);
    if(!g_board.rtc()->SetTime(utc))ESP_LOGW(kTag,"RTC synchronization failed");
    g_board.ReleaseAudio();
}
void HomeTask(void* argument) {
    auto* request=static_cast<HomeRequest*>(argument);
    request->ok=nido::DeviceHome(request->snapshot,*request->anchor ? request->anchor : nullptr,request->dismiss);
    xQueueSend(g_home_events,&request,portMAX_DELAY);vTaskDelete(nullptr);
}
void DrawCurrent() {
    LocalToday();
    const auto* day=nido::FindHomeDay(g_home,g_selected_date);
    if(!day && nido::ValidHomeDate(g_selected_date)) {
        g_placeholder={};std::strcpy(g_placeholder.date,g_selected_date);
        int y,m,d;std::sscanf(g_selected_date,"%d-%d-%d",&y,&m,&d);tm parsed{};parsed.tm_year=y-1900;parsed.tm_mon=m-1;parsed.tm_mday=d;parsed.tm_hour=12;
        const time_t stamp=nido::UtcSeconds(parsed);gmtime_r(&stamp,&parsed);
        const char* weekdays[]={"domingo","lunes","martes","miércoles","jueves","viernes","sábado"};
        const char* months[]={"ene","feb","mar","abr","may","jun","jul","ago","sep","oct","nov","dic"};
        std::snprintf(g_placeholder.label,sizeof(g_placeholder.label),"%s %02d %s",weekdays[parsed.tm_wday],d,months[m-1]);day=&g_placeholder;
    }
    nido::DrawHome(g_day_canvas,day,g_today,g_sync_active,g_home_failed || g_update_failed,g_home.demo,g_low_battery,&g_home);
    if(g_flow.modal())nido::DrawModal(g_canvas,g_day_canvas,g_modal_card);else g_canvas=g_day_canvas;
}
bool StartHomeSync(bool today=false,bool dismiss=false) {
    if(g_sync_active)return false;
    auto* request=new(std::nothrow) HomeRequest{};
    if(!request){g_home_failed=true;g_next_sync_us=esp_timer_get_time()+nido::kRefreshUs;return false;}
    request->today=today;request->dismiss=dismiss;
    if(!today)std::strcpy(request->anchor,g_selected_date);
    if(xTaskCreate(HomeTask,"nido_home",8192,request,3,nullptr)!=pdPASS){delete request;g_home_failed=true;g_next_sync_us=esp_timer_get_time()+nido::kRefreshUs;return false;}
    g_sync_active=true;DrawCurrent();return true;
}
bool FinishHomeSync() {
    HomeRequest* request=nullptr;
    if(xQueueReceive(g_home_events,&request,0)!=pdTRUE)return false;
    g_sync_active=false;g_next_sync_us=esp_timer_get_time()+nido::kRefreshUs;g_home_failed=!request->ok;
    g_boot_display.HomeResult(request->ok);
    if(request->ok){
        g_update_failed=false;
        g_check_update=true;
        const bool follow_today=!(*g_selected_date) || std::strcmp(g_selected_date,g_home.today)==0;
        g_home=request->snapshot;
        if(follow_today)std::strcpy(g_selected_date,g_home.today);
        SynchronizeClock(g_home.server_time);
    }
    delete request;
    if(g_pending_today){const bool dismiss=g_pending_dismiss;g_pending_today=false;g_pending_dismiss=false;StartHomeSync(true,dismiss);}
    // Codec and screen are owned by the audio path while it captures.
    if(g_flow.mode!=nido::UiMode::Capturing)DrawCurrent();
    return true;
}
void WaitHomeSync() {
    while(g_sync_active){FinishHomeSync();vTaskDelay(pdMS_TO_TICKS(10));}
}
void ReturnToday(bool dismiss) {
    g_flow.Dispatch(nido::UiEvent::Dismiss);
    g_button_latched=0;g_catching_buttons=false;
    gpio_intr_disable(GPIO_NUM_39);gpio_intr_disable(GPIO_NUM_18);
    LocalToday();std::strcpy(g_selected_date,g_today);
    if(g_sync_active){g_pending_today=true;g_pending_dismiss=g_pending_dismiss||dismiss;}
    else StartHomeSync(true,dismiss);
    DrawCurrent();
}


int64_t SessionRemaining() {
    timeval now{}; gettimeofday(&now,nullptr);
    return nido::SessionRemainingUs(g_session_expires_at,now.tv_sec * 1000000LL + now.tv_usec);
}

void IRAM_ATTR ChoiceInterrupt(void* argument) {
    if (g_catching_buttons && !g_button_latched) g_button_latched = static_cast<int>(reinterpret_cast<intptr_t>(argument));
}

struct AudioEvent {
    bool ready = false;
    bool failed = false;
    bool limited = false;
    int16_t* pcm = nullptr;
    size_t samples = 0;
};

bool FrontHeld() { return gpio_get_level(ZECTRIX_BUTTON_OK) == 0; }

void PinLow(gpio_num_t pin) {
    gpio_hold_dis(pin);
    ESP_ERROR_CHECK(gpio_set_direction(pin, GPIO_MODE_OUTPUT));
    ESP_ERROR_CHECK(gpio_set_level(pin, 0));
    ESP_ERROR_CHECK(gpio_hold_en(pin));
}

void RestorePins() {
    gpio_deep_sleep_hold_dis();
    for (gpio_num_t pin : {GPIO_NUM_0, GPIO_NUM_5, GPIO_NUM_18}) {
        ESP_ERROR_CHECK(rtc_gpio_deinit(pin));
    }
    for (gpio_num_t pin : {GPIO_NUM_6, GPIO_NUM_9, GPIO_NUM_10, GPIO_NUM_11,
                          GPIO_NUM_12, GPIO_NUM_13, GPIO_NUM_14, GPIO_NUM_15,
                          GPIO_NUM_38, GPIO_NUM_45, GPIO_NUM_47, GPIO_NUM_48}) {
        gpio_hold_dis(pin);
    }
}

esp_err_t PreparePanel() {
    if (!g_panel) {
        zectrix_epd_config_t config;
        zectrix_epd_get_default_config(&config);
        esp_err_t result = zectrix_epd_new(&config, &g_panel);
        if (result != ESP_OK) return result;
    }
    return zectrix_epd_power_on(g_panel);
}
esp_err_t Paint(bool wifi_warning = false) {
    if(!g_boot_display.CanPaint())return ESP_OK;
    if (!nido::DeviceEnabled()) nido::DrawStatusIcons(g_canvas,g_low_battery,!wifi_warning || nido::DeviceWifiConnected());
    esp_err_t powered = PreparePanel();
    if (powered != ESP_OK) return powered;
    esp_err_t result = ESP_OK;
    if (!g_have_frame) {
        result = zectrix_epd_refresh_full_1bpp(g_panel, g_canvas.data(), g_canvas.size());
    } else {
        int first = 300, last = -1;
        for (int row = 0; row < 300; ++row) {
            if (std::memcmp(g_canvas.data() + row * 50,
                            g_previous.data() + row * 50, 50) != 0) {
                first = std::min(first, row);
                last = row;
            }
        }
        if (last < first) return ESP_OK;
        const zectrix_epd_rect_t rect{0, first, 400, last - first + 1};
        result = zectrix_epd_refresh_partial_1bpp(g_panel, &rect,
            g_canvas.data() + first * 50, static_cast<size_t>(rect.height) * 50);
    }
    if (result == ESP_OK) {
        g_previous = g_canvas;
        g_have_frame = true;
    }
    return result;
}

void DevicePaint(const nido::DeviceCard& card) {
    g_boot_display.ShowInteraction();
    if (std::strcmp(card.type,"binary")==0 && std::strcmp(card.status,"question")==0) {
        if (std::strcmp(card.id,g_button_card)!=0) {
            g_button_latched = 0;
            std::strcpy(g_button_card,card.id);
        }
        g_catching_buttons = true;
        gpio_set_intr_type(GPIO_NUM_39,GPIO_INTR_NEGEDGE);
        gpio_set_intr_type(GPIO_NUM_18,GPIO_INTR_NEGEDGE);
        gpio_intr_enable(GPIO_NUM_39); gpio_intr_enable(GPIO_NUM_18);
    } else {
        g_catching_buttons = false;
        gpio_intr_disable(GPIO_NUM_39); gpio_intr_disable(GPIO_NUM_18);
        g_button_latched = 0;
    }
    g_modal_card=card;DrawCurrent();
    ESP_ERROR_CHECK_WITHOUT_ABORT(Paint());
    if(!g_feedback_played && std::strcmp(card.status,"progress")!=0) {
        g_feedback_played=true;
        PlaySound(std::strcmp(card.status,"question")==0 ? nido::Sound::Question :
                  std::strcmp(card.status,"error")==0 || std::strcmp(card.status,"partial")==0 ? nido::Sound::Error : nido::Sound::Result);
    }
}

void PlaySound(nido::Sound sound) {
    g_board.SetAudioPower(true);
    vTaskDelay(pdMS_TO_TICKS(40));
    if (AudioCodec* codec = g_board.PrepareAudio(); codec && codec->valid()) {
        codec->EnableInput(false);
        codec->SetOutputVolume(80);
        codec->EnableOutput(true);
        const auto pcm=nido::SoundData(sound);
        // Let the DAC/amplifier settle with actual zero-valued I2S frames,
        // rather than letting its cold start consume the first short note.
        constexpr size_t lead_silence=kRate*80/1000, tail_silence=kRate*20/1000;
        std::vector<int16_t> tone(lead_silence+pcm.count+tail_silence,0);
        std::copy(pcm.samples,pcm.samples+pcm.count,tone.begin()+lead_silence);
        ESP_LOGI(kTag,"speaker sound=%d pcm=%u rate=%d",static_cast<int>(sound),static_cast<unsigned>(pcm.count),kRate);
        codec->OutputData(tone);
        // I2S write queues DMA; let the short tone reach the speaker before
        // closing the codec and cutting its power rail.
        vTaskDelay(pdMS_TO_TICKS(tone.size()*1000/kRate+40));
    }
    g_board.ReleaseAudio();
}

int CancelClick() { return g_cancel_network.exchange(0); }

void DeviceFinished(const nido::DeviceResult& result) {
    if(result.cancelled) {
        if(!g_network_jobs.empty()){g_flow.mode=nido::UiMode::Processing;return;}
        g_flow.mode=nido::UiMode::Day;g_catching_buttons=false;g_session_expires_at=0;
        LocalToday();std::strcpy(g_selected_date,g_today);
        DrawCurrent();ESP_ERROR_CHECK_WITHOUT_ABORT(Paint());StartHomeSync();return;
    }
    if(result.session_expires_at)g_session_expires_at=result.session_expires_at;
    else g_session_expires_at=static_cast<int64_t>(time(nullptr))+300;
    SynchronizeClock(result.server_time);
    const auto power=g_board.ReadPowerSnapshot();g_low_battery=nido::ShowLowBattery(power.battery_valid,power.battery_percent);
    if(result.ok) {
        g_flow.Dispatch(result.question ? nido::UiEvent::Ask : result.uncertain ? nido::UiEvent::Unknown : std::strcmp(result.card.status,"error")==0 ? nido::UiEvent::Fail : nido::UiEvent::Done);
        if(result.question){std::strcpy(g_question_turn,result.turn);std::strcpy(g_question_card,result.card.id);}
        DevicePaint(result.card);
    } else {
        g_flow.Dispatch(result.uncertain ? nido::UiEvent::Unknown : nido::UiEvent::Fail);
        nido::DeviceCard card={};std::strcpy(card.status,"error");std::strcpy(card.type,"text");
        std::strcpy(card.title,result.uncertain ? "Revisar resultado" : "No puedo conectar");
        std::strcpy(card.body,result.uncertain ? "No he podido confirmar el resultado. Puede haberse guardado. Pide que lo compruebe." : "No he podido conectar con Nido. Tu petición no se ha enviado.");
        DevicePaint(card);
    }

    if(!result.question) {
        char previous[11];std::strcpy(previous,g_selected_date);
        if(result.ok && *result.affected_date)std::strcpy(g_selected_date,result.affected_date);
        if(g_network_jobs.empty() && StartHomeSync()) {ESP_ERROR_CHECK_WITHOUT_ABORT(Paint());WaitHomeSync();}
        if(g_network_jobs.empty() && result.ok && *result.affected_date && !g_home_failed) {
            g_flow.Dispatch(nido::UiEvent::Dismiss);g_catching_buttons=false;
        } else if(g_network_jobs.empty() && result.ok && *result.affected_date && g_home_failed) {
            std::strcpy(g_selected_date,previous);
            nido::DeviceCard card={};std::strcpy(card.status,"partial");std::strcpy(card.type,"text");
            std::strcpy(card.title,"Cambio guardado");std::strcpy(card.body,"Se ha guardado el cambio, pero no he podido actualizar la vista del día.");g_modal_card=card;
        }
        DrawCurrent();ESP_ERROR_CHECK_WITHOUT_ABORT(Paint());
    }
}

// Network work never owns the canvas or audio codec. UI events are applied on main.
void NetworkPaint(const nido::DeviceCard& card) {
    auto* event=AllocateNetworkEvent();
    if(!event)return;
    event->card=card;xQueueSend(g_network_events,&event,portMAX_DELAY);
}
void NetworkTask(void* argument) {
    auto* job=static_cast<NetworkJob*>(argument);
    auto* event=job->completion;
    event->done=true;
    if(job->answer)nido::DeviceAnswer(event->result,job->turn,job->card,job->upper,NetworkPaint,CancelClick);
    else nido::DeviceAudio(event->result,job->pcm,job->samples,NetworkPaint,CancelClick);
    heap_caps_free(job->pcm);delete job;
    xQueueSend(g_network_events,&event,portMAX_DELAY);vTaskDelete(nullptr);
}
void StartNextNetwork() {
    if(g_network_active || g_network_jobs.empty() || nido::DeviceWifiWarming())return;
    WaitHomeSync();
    // The idle task reclaims the self-deleted audio/home task stacks.
    vTaskDelay(pdMS_TO_TICKS(20));
    auto* job=g_network_jobs.front();g_network_jobs.pop_front();
    g_network_active=true;g_cancel_network=0;g_feedback_played=false;g_flow.mode=nido::UiMode::Processing;
    // Results live in PSRAM; no full-card return temporaries occupy the stack.
    job->completion=AllocateNetworkEvent();
    if(!job->completion || xTaskCreate(NetworkTask,"nido_network",16384,job,4,nullptr)!=pdPASS) {
        ESP_LOGE(kTag,"network stack allocation failed internal_free=%u largest=%u",
            static_cast<unsigned>(heap_caps_get_free_size(MALLOC_CAP_INTERNAL|MALLOC_CAP_8BIT)),
            static_cast<unsigned>(heap_caps_get_largest_free_block(MALLOC_CAP_INTERNAL|MALLOC_CAP_8BIT)));
        if(job->completion)FreeNetworkEvent(job->completion);
        g_network_active=false;heap_caps_free(job->pcm);delete job;
        nido::DeviceCard error={};std::strcpy(error.status,"error");std::strcpy(error.type,"text");
        std::strcpy(error.title,"No puedo enviar");std::strcpy(error.body,"No hay memoria para enviar el mensaje.");
        g_flow.Dispatch(nido::UiEvent::Fail);DevicePaint(error);
    }
}
void DrainNetwork() {
    NetworkEvent* event=nullptr;
    while(xQueueReceive(g_network_events,&event,0)==pdTRUE) {
        if(event->done){
            g_network_active=false;
            const bool clarification_failed=!g_network_jobs.empty() && event->result.uncertain && !event->result.cancelled;
            if(clarification_failed){for(auto* job:g_network_jobs){heap_caps_free(job->pcm);delete job;}g_network_jobs.clear();}
            DeviceFinished(event->result);
            if(clarification_failed){
                nido::DeviceCard warning={};std::strcpy(warning.status,"error");std::strcpy(warning.type,"text");
                std::strcpy(warning.title,"Revisar petición");std::strcpy(warning.body,"No pude confirmar la parada. La aclaración no se ha enviado. Pide que compruebe qué se guardó.");DevicePaint(warning);
            }
        }
        else DevicePaint(event->card);
        FreeNetworkEvent(event);
    }
    StartNextNetwork();
}

// Audio starts before the potentially slow e-paper refresh. The LED is the
// ready indication; no Wi-Fi reconnect or panel refresh can truncate speech.
void RecordTask(void*) {
    AudioEvent done;
    const size_t capacity = CONFIG_NIDO_RECORD_MAX_SECONDS * kRate;
    done.pcm = static_cast<int16_t*>(heap_caps_malloc(
        capacity * sizeof(int16_t), MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT));
    if (!done.pcm || !FrontHeld()) {
        done.failed = !done.pcm;
        xQueueSend(g_audio_events, &done, portMAX_DELAY);
        vTaskDelete(nullptr);
        return;
    }
    g_board.SetAudioPower(true);
    vTaskDelay(pdMS_TO_TICKS(40));
    AudioCodec* codec = g_board.PrepareAudio();
    if (!codec || !codec->valid()) {
        done.failed = true;
    } else {
        codec->EnableOutput(false);
        codec->EnableInput(true);
        // Play inside the existing codec warm-up, never wait for a click threshold.
        const int64_t warm_until=esp_timer_get_time()+180000;
        int64_t sound_until=0;
        if(FrontHeld()) {
            const auto pcm=nido::SoundData(nido::Sound::Recording);
            std::vector<int16_t> tone(kRate*80/1000+pcm.count,0); // 60 ms lead, 20 ms tail
            std::copy(pcm.samples,pcm.samples+pcm.count,tone.begin()+kRate*60/1000);
            codec->SetOutputVolume(80);codec->EnableOutput(true);codec->OutputData(tone);
            sound_until=esp_timer_get_time()+tone.size()*1000000LL/kRate+40000;
        }
        const int64_t remaining=warm_until-esp_timer_get_time();
        if(remaining>0)vTaskDelay(pdMS_TO_TICKS((remaining+999)/1000));
        std::vector<int16_t> chunk(kChunk);
        if (!codec->InputData(chunk)) {
            done.failed = true;
        } else if (FrontHeld()) {
            g_board.SetPowerLed(true);
            AudioEvent ready;
            ready.ready = true;
            xQueueSend(g_audio_events, &ready, portMAX_DELAY);
            const int64_t deadline = esp_timer_get_time() +
                CONFIG_NIDO_RECORD_MAX_SECONDS * 1000000LL;
            while (FrontHeld() && !g_abort_audio && done.samples + kChunk <= capacity &&
                   esp_timer_get_time() < deadline) {
                if (!codec->InputData(chunk)) {
                    done.failed = true;
                    break;
                }
                std::memcpy(done.pcm + done.samples, chunk.data(),
                            kChunk * sizeof(int16_t));
                done.samples += kChunk;
                // RX may already contain buffered samples, so counting reads
                // does not prove the queued speaker DMA has finished.
                if(sound_until && esp_timer_get_time()>=sound_until) {
                    codec->EnableOutput(false);sound_until=0;
                }
            }
            done.limited = FrontHeld() && !g_abort_audio && !done.failed;
        }
    }
    g_board.SetPowerLed(false);
    g_board.ReleaseAudio();
    xQueueSend(g_audio_events, &done, portMAX_DELAY);
    vTaskDelete(nullptr);
}

void Record() {
    g_abort_audio=false;
    const auto previous_mode=g_flow.mode;
    const bool previous_feedback=g_feedback_played;
    const auto free_card=[](nido::DeviceCard* card){heap_caps_free(card);};
    std::unique_ptr<nido::DeviceCard,decltype(free_card)> previous_card(nullptr,free_card);
    if(nido::DeviceEnabled() && g_flow.modal()) {
        previous_card.reset(static_cast<nido::DeviceCard*>(heap_caps_malloc(
            sizeof(nido::DeviceCard),MALLOC_CAP_SPIRAM|MALLOC_CAP_8BIT)));
        if(!previous_card){ESP_LOGE(kTag,"cannot preserve conversation before capture");return;}
        std::memcpy(previous_card.get(),&g_modal_card,sizeof(g_modal_card));
    }
    g_feedback_played=false;
    const int64_t pressed_at=esp_timer_get_time();
    int64_t released_at=0;
    g_flow.Dispatch(nido::UiEvent::Press);
    ++g_turns;
    ESP_LOGI(kTag, "turn=%lu recording limit=%ds wifi=off",
        static_cast<unsigned long>(g_turns), CONFIG_NIDO_RECORD_MAX_SECONDS);
    if (xTaskCreate(RecordTask, "nido_audio", 6144, nullptr, 5, nullptr) != pdPASS) {
        nido::DrawRecorded(g_canvas, {}, false, true);
        ESP_LOGE(kTag, "record task allocation failed");
        ESP_ERROR_CHECK_WITHOUT_ABORT(Paint());
        return;
    }
    if(nido::DeviceEnabled() && !g_network_active && !g_sync_active)nido::DeviceWarmWifi();
    AudioEvent event;
    const int64_t deadline = esp_timer_get_time() +
        (CONFIG_NIDO_RECORD_MAX_SECONDS + 15LL) * 1000000;
    for (;;) {
        if (esp_timer_get_time() >= deadline) {
            ESP_LOGE(kTag, "audio deadline exceeded; reset to quiesce the codec");
            esp_restart();
        }
        if(nido::DeviceEnabled() && FrontHeld() && gpio_get_level(GPIO_NUM_18)==0){g_abort_audio=true;g_request_maintenance=true;}
        if(!released_at && !FrontHeld())released_at=esp_timer_get_time();
        if (xQueueReceive(g_audio_events, &event, pdMS_TO_TICKS(10)) != pdTRUE) continue;
        if(g_abort_audio && !event.ready){heap_caps_free(event.pcm);g_flow.mode=previous_mode;return;}
        if (event.ready) {
            if(g_abort_audio)continue;
            if(nido::DeviceEnabled()) {
                nido::DeviceCard listening={};std::strcpy(listening.status,"progress");std::strcpy(listening.type,"text");std::strcpy(listening.title,"Te escucho…");
                DevicePaint(listening);
            } else {nido::DrawListening(g_canvas,false);ESP_ERROR_CHECK_WITHOUT_ABORT(Paint());}
            continue;
        }
        if(!released_at && !FrontHeld())released_at=esp_timer_get_time();
        const bool click=nido::IsFrontClick(released_at-pressed_at,released_at!=0,event.samples);
        ESP_LOGI(kTag,"front release held_ms=%lld samples=%u click=%d",
            released_at ? (released_at-pressed_at)/1000 : -1LL,
            static_cast<unsigned>(event.samples),click);
        if(nido::DeviceEnabled() && click) {
            heap_caps_free(event.pcm);
            if(g_network_active) {
                g_cancel_network=1;
                for(auto* job:g_network_jobs){heap_caps_free(job->pcm);delete job;}g_network_jobs.clear();
                g_flow.mode=nido::UiMode::Processing;
                nido::DeviceCard stopping={};std::strcpy(stopping.status,"progress");std::strcpy(stopping.type,"text");std::strcpy(stopping.title,"Deteniendo…");DevicePaint(stopping);
            } else {
                for(auto* job:g_network_jobs){heap_caps_free(job->pcm);delete job;}g_network_jobs.clear();
                g_flow.Dispatch(nido::UiEvent::Click);ReturnToday(true);ESP_ERROR_CHECK_WITHOUT_ABORT(Paint());
            }
            return;
        }
        if(nido::DeviceEnabled() && !event.failed && !event.limited &&
           nido::IsAccidentalRecording(event.samples,kRate)) {
            ESP_LOGI(kTag,"accidental recording discarded samples=%u",static_cast<unsigned>(event.samples));
            heap_caps_free(event.pcm);g_accept_next_press=true;
            g_flow.mode=previous_mode;
            // Restore the prior view without replaying its sound or renewing expiry.
            if(previous_card){g_feedback_played=true;DevicePaint(*previous_card);}
            else {DrawCurrent();ESP_ERROR_CHECK_WITHOUT_ABORT(Paint());}
            g_feedback_played=previous_feedback;
            return;
        }
        const nido::AudioSummary summary = nido::SummarizePcm(event.pcm, event.samples, kRate);
        g_accept_next_press = !event.failed && !event.limited && event.samples > 0;
        ESP_LOGI(kTag, "recorded ms=%lu samples=%u peak=%lu rms=%lu limited=%d failed=%d",
            static_cast<unsigned long>(summary.duration_ms), static_cast<unsigned>(event.samples),
            static_cast<unsigned long>(summary.peak), static_cast<unsigned long>(summary.rms),
            event.limited, event.failed);
        ESP_LOGI(kTag, "session boots=%lu rtc_probe_result=%lu (1=RTC interrupt, 2=fallback/interrupted)",
            static_cast<unsigned long>(g_boots), static_cast<unsigned long>(g_rtc_probe_result));
        if (nido::DeviceEnabled() && !event.failed && !event.limited && summary.has_signal && summary.duration_ms >= 1000) {
            g_flow.Dispatch(nido::UiEvent::SendAudio);
            nido::DeviceCard progress={};std::strcpy(progress.status,"progress");std::strcpy(progress.type,"text");std::strcpy(progress.title,"Estoy preparando tu petición");
            auto* job=new(std::nothrow) NetworkJob;
            if(job){job->pcm=event.pcm;job->samples=event.samples;event.pcm=nullptr;g_network_jobs.push_back(job);
                if(g_network_active)g_cancel_network=2;
                StartNextNetwork();
                if(g_network_active || !g_network_jobs.empty())DevicePaint(progress);
            }
            else {g_flow.Dispatch(nido::UiEvent::Fail);PlaySound(nido::Sound::Error);}
        } else if (nido::DeviceEnabled()) {
            nido::DeviceCard card = {};
            std::strcpy(card.status,"error"); std::strcpy(card.type,"text");
            std::strcpy(card.title,event.limited ? "Grabación demasiado larga" : "No he recibido audio");
            std::strcpy(card.body,event.limited ? "Se ha superado el límite de grabación." : "No se ha capturado una grabación válida.");
            g_flow.Dispatch(nido::UiEvent::Fail);DevicePaint(card);
            g_session_expires_at = static_cast<int64_t>(time(nullptr)) + 300;
        } else {
            nido::DrawRecorded(g_canvas, summary, event.limited, event.failed);
            ESP_ERROR_CHECK_WITHOUT_ABORT(Paint());
        }
        heap_caps_free(event.pcm);
        return;
    }
}

bool MaintenancePower() {
    const auto power=g_board.ReadPowerSnapshot();
    return nido::UpdatePowerAllowed(power.battery_valid,power.battery_percent,power.charge.power_present && !power.charge.fault);
}
void MaintenancePaint(const nido::DeviceCard& card) {
    g_boot_display.ShowInteraction();
    nido::DrawModal(g_canvas,g_day_canvas,card);ESP_ERROR_CHECK_WITHOUT_ABORT(Paint());
}
void FirmwarePaint(bool failed) {
    g_update_failed=failed;
    g_canvas=g_day_canvas;
    nido::DrawFirmwareUpdate(g_canvas,failed);ESP_ERROR_CHECK_WITHOUT_ABORT(Paint());
}
void MaintenanceMessage(const char* title,const char* body) {
    nido::DeviceCard card={};std::strcpy(card.type,"text");std::strcpy(card.status,"progress");
    std::snprintf(card.title,sizeof(card.title),"%s",title);std::snprintf(card.body,sizeof(card.body),"%s",body);MaintenancePaint(card);
}
bool MaintenanceChord() {
    if(!FrontHeld() || gpio_get_level(GPIO_NUM_18)!=0)return false;
    nido::MaintenanceGesture gesture;
    while(FrontHeld() && gpio_get_level(GPIO_NUM_18)==0) {
        gesture.Tick(true,true,esp_timer_get_time()/1000);
        if(gesture.ready)break;
        vTaskDelay(pdMS_TO_TICKS(20));
    }
    if(!gesture.ready)return true; // Consume incomplete chords without a voice/navigation action.
    MaintenanceMessage("Configurar Nido","Suelta los dos botones para entrar en mantenimiento.");
    while(FrontHeld() || gpio_get_level(GPIO_NUM_18)==0)vTaskDelay(pdMS_TO_TICKS(20));
    return gesture.Tick(false,false,esp_timer_get_time()/1000) && (g_request_maintenance=true);
}
void RunMaintenance() {
    for(auto* job:g_network_jobs){heap_caps_free(job->pcm);delete job;}g_network_jobs.clear();
    if(g_network_active)g_cancel_network=1;
    MaintenanceMessage("Preparando mantenimiento","Estoy cerrando la conexión actual. Los cambios ya guardados se conservan.");
    WaitHomeSync();
    const int64_t deadline=esp_timer_get_time()+20000000;
    while((g_network_active || nido::DeviceWifiWarming()) && esp_timer_get_time()<deadline){DrainNetwork();vTaskDelay(pdMS_TO_TICKS(20));}
    if(g_network_active||nido::DeviceWifiWarming()){MaintenanceMessage("Mantenimiento no disponible","Espera a que termine la conexión y vuelve a mantener los dos botones.");g_request_maintenance=false;return;}
    MaintenanceMessage("Buscando actualizaciones","Consultando GitHub…");
    char release[32]={};
    if(nido::DeviceGithubCheck(release,sizeof(release))){
        auto card=std::make_unique<nido::DeviceCard>();std::strcpy(card->type,"binary");std::strcpy(card->status,"question");std::strcpy(card->title,"Nueva versión disponible");std::snprintf(card->body,sizeof(card->body),"%s\n¿Quieres instalarla ahora?",release);std::strcpy(card->labels[0],"Actualizar");std::strcpy(card->labels[1],"Configurar");MaintenancePaint(*card);
        bool update=false,armed=false;const int64_t choice_deadline=esp_timer_get_time()+30000000LL;
        while(esp_timer_get_time()<choice_deadline){
            const bool front=FrontHeld(),lower=gpio_get_level(GPIO_NUM_18)==0,upper=gpio_get_level(GPIO_NUM_39)==0;
            if(!front&&!lower&&!upper)armed=true;
            if(armed&&(front||lower))break;
            if(armed&&upper){update=true;break;}
            nido::DeviceBootGuard();vTaskDelay(pdMS_TO_TICKS(20));
        }
        if(update){FirmwarePaint(false);
            if(!nido::DeviceGithubInstall(MaintenancePower)){MaintenanceMessage("Actualización no instalada","Comprueba la conexión y la batería. Abriendo configuración…");vTaskDelay(pdMS_TO_TICKS(2000));}}
    }
    if(!nido::DeviceMaintenanceStart(MaintenancePower)){MaintenanceMessage("Mantenimiento no disponible","Espera a que termine la conexión y vuelve a mantener los dos botones.");g_request_maintenance=false;return;}
    char body[320];std::snprintf(body,sizeof(body),"red: %s\nsin contraseña\nAbre http://192.168.4.1\nFrontal + inferior: salir\n%s",nido::DeviceMaintenanceName(),nido::DeviceVersion());
    if(nido::DrawMaintenance(g_canvas,g_day_canvas,nido::DeviceMaintenanceName(),nido::DeviceVersion()))ESP_ERROR_CHECK_WITHOUT_ABORT(Paint());
    else MaintenanceMessage("Configurar Nido",body);
    nido::MaintenanceGesture exit;
    while(nido::DeviceMaintenanceTick(exit.Tick(FrontHeld(),gpio_get_level(GPIO_NUM_18)==0,esp_timer_get_time()/1000))){nido::DeviceCard pairing={};if(nido::DevicePairingCard(pairing))MaintenancePaint(pairing);nido::DeviceBootGuard();vTaskDelay(pdMS_TO_TICKS(20));}
    if(nido::DeviceConfigured() && g_have_frame)nido::DeviceConfirmFirmware();
    g_request_maintenance=false;g_flow.Dispatch(nido::UiEvent::Dismiss);g_catching_buttons=false;g_button_latched=0;g_session_expires_at=0;g_next_sync_us=0;DrawCurrent();ESP_ERROR_CHECK_WITHOUT_ABORT(Paint());
}

uint64_t HighPins() {
    uint64_t high = 0;
    for (gpio_num_t pin : {GPIO_NUM_0, GPIO_NUM_5, GPIO_NUM_18, GPIO_NUM_39}) {
        if (gpio_get_level(pin)) high |= 1ULL << pin;
    }
    return high;
}

// Block the CPU between inputs; all three buttons can wake light sleep.
// This first prototype gives navigation buttons no conversation semantics.
bool WaitForFront(uint32_t duration_ms) {
    const int64_t deadline = esp_timer_get_time() + duration_ms * 1000LL;
    while (esp_timer_get_time() < deadline) {
        if (FrontHeld()) return true;
        ESP_ERROR_CHECK(esp_sleep_disable_wakeup_source(ESP_SLEEP_WAKEUP_ALL));
        const uint64_t high = HighPins();
        for (gpio_num_t pin : {GPIO_NUM_0, GPIO_NUM_18, GPIO_NUM_39}) {
            ESP_ERROR_CHECK(gpio_wakeup_disable(pin));
            if (high & (1ULL << pin)) {
                ESP_ERROR_CHECK(gpio_wakeup_enable(pin, GPIO_INTR_LOW_LEVEL));
            }
        }
        ESP_ERROR_CHECK(esp_sleep_enable_gpio_wakeup());
        ESP_ERROR_CHECK(esp_sleep_enable_timer_wakeup(std::max<int64_t>(
            1000, deadline - esp_timer_get_time())));
        const esp_err_t result = esp_light_sleep_start();
        if (result != ESP_OK && result != ESP_ERR_SLEEP_REJECT) {
            ESP_LOGW(kTag, "light sleep: %s", esp_err_to_name(result));
            vTaskDelay(pdMS_TO_TICKS(50));
        }
    }
    return false;
}

// GPIO39 cannot wake deep sleep. A pending binary question uses one bounded
// light-sleep window with the radio off, then returns to deep sleep.
int WaitForInput(int64_t deadline) {
    g_board.ReleaseAudio();
    g_board.SetPowerLed(false);
    if(g_panel)ESP_ERROR_CHECK_WITHOUT_ABORT(zectrix_epd_power_off(g_panel));
    // Wakeup changes the pin interrupt type to a level. Disable CPU ISR delivery
    // before sleeping so a held button cannot generate an interrupt storm.
    g_catching_buttons = false;
    gpio_intr_disable(GPIO_NUM_39); gpio_intr_disable(GPIO_NUM_18);
    bool front_armed = !FrontHeld();
    bool upper_armed = gpio_get_level(GPIO_NUM_39) != 0;
    bool lower_armed = gpio_get_level(GPIO_NUM_18) != 0;
    int choice = 0;
    ESP_LOGI(kTag,"waiting: radio off, panel off, audio off, all buttons enabled");
    while (esp_timer_get_time() < deadline) {
        if (g_button_latched) { choice = g_button_latched; g_button_latched=0;break; }
        if (!FrontHeld()) front_armed=true;
        else if(front_armed) { choice = 1; break; }
        if (gpio_get_level(GPIO_NUM_39)) upper_armed = true;
        else if (upper_armed) { choice = 2; break; }
        if (gpio_get_level(GPIO_NUM_18)) lower_armed = true;
        else if (lower_armed) { choice = 3; break; }
        ESP_ERROR_CHECK(esp_sleep_disable_wakeup_source(ESP_SLEEP_WAKEUP_ALL));
        for (gpio_num_t pin : {GPIO_NUM_0, GPIO_NUM_18, GPIO_NUM_39}) {
            const bool released = gpio_get_level(pin) != 0;
            ESP_ERROR_CHECK(gpio_wakeup_disable(pin));
            ESP_ERROR_CHECK(gpio_wakeup_enable(pin,released ? GPIO_INTR_LOW_LEVEL : GPIO_INTR_HIGH_LEVEL));
        }
        ESP_ERROR_CHECK(esp_sleep_enable_gpio_wakeup());
        ESP_ERROR_CHECK(esp_sleep_enable_timer_wakeup(std::max<int64_t>(1000,deadline-esp_timer_get_time())));
        const esp_err_t error = esp_light_sleep_start();
        if (error != ESP_OK) vTaskDelay(pdMS_TO_TICKS(50));
    }
    g_catching_buttons = false;
    gpio_intr_disable(GPIO_NUM_39); gpio_intr_disable(GPIO_NUM_18);
    return choice;
}

void DeepSleep() {
    ESP_ERROR_CHECK(esp_sleep_disable_wakeup_source(ESP_SLEEP_WAKEUP_ALL));
    if (g_session_expires_at && SessionRemaining() == 0) {
        g_session_expires_at = 0;
        nido::DrawReady(g_canvas,true);
        ESP_ERROR_CHECK_WITHOUT_ABORT(Paint());
    }
    uint64_t next_wake = static_cast<uint64_t>(SessionRemaining());
    // RTC work happens once, before peripheral shutdown. No RTC polling.
    RtcPcf8563* rtc = g_board.rtc();
    bool rtc_armed = false;
    if (rtc) {
        const bool cleared = rtc->DisableAlarm() && rtc->StopCountdownTimer() &&
            rtc->ClearTimerFlag() && rtc->DisableClockOutput();
        if (g_rtc_test_pending && cleared) {
            rtc_armed = rtc->StartCountdownTimer(CONFIG_NIDO_RTC_WAKE_TEST_SECONDS);
            g_rtc_test_pending = false;
        }
    }
    g_rtc_test_armed = rtc_armed;
    if (rtc_armed) {
        // Independent fallback identifies a lost RTC interrupt; no infinite wait.
        next_wake = nido::EarlierWake(next_wake,(CONFIG_NIDO_RTC_WAKE_TEST_SECONDS + 5ULL) * 1000000);
    }
    g_board.ReleaseAudio();
    g_board.SetPowerLed(false);
    if (g_panel) {
        ESP_ERROR_CHECK_WITHOUT_ABORT(zectrix_epd_del(g_panel));
        g_panel = nullptr;
    }
    // GPIO3 LED is active-low: SetPowerLed(false) already holds it HIGH.
    for (gpio_num_t pin : {GPIO_NUM_6, GPIO_NUM_9, GPIO_NUM_10,
                          GPIO_NUM_11, GPIO_NUM_12, GPIO_NUM_13, GPIO_NUM_14,
                          GPIO_NUM_15, GPIO_NUM_21, GPIO_NUM_38, GPIO_NUM_42,
                          GPIO_NUM_45, GPIO_NUM_46}) {
        PinLow(pin);
    }
    // Stop the I2C pullups from feeding an unpowered codec through SDA/SCL.
    for (gpio_num_t pin : {GPIO_NUM_8, GPIO_NUM_16, GPIO_NUM_47, GPIO_NUM_48}) {
        ESP_ERROR_CHECK(gpio_set_direction(pin, GPIO_MODE_INPUT));
        ESP_ERROR_CHECK(gpio_set_pull_mode(pin, GPIO_FLOATING));
    }
    uint64_t high = 0;
    for (gpio_num_t pin : {GPIO_NUM_0, GPIO_NUM_5, GPIO_NUM_18}) {
        ESP_ERROR_CHECK(rtc_gpio_init(pin));
        ESP_ERROR_CHECK(rtc_gpio_set_direction(pin, RTC_GPIO_MODE_INPUT_ONLY));
        ESP_ERROR_CHECK(rtc_gpio_pullup_en(pin));
        ESP_ERROR_CHECK(rtc_gpio_pulldown_dis(pin));
        if (rtc_gpio_get_level(pin)) high |= 1ULL << pin;
    }
    // A held/stuck button must not cause an endless sleep/wake loop.
    const uint64_t mask = nido::DeepWakeMask(high, rtc_armed);
    if (mask) {
        ESP_ERROR_CHECK(esp_sleep_enable_ext1_wakeup_io(mask, ESP_EXT1_WAKEUP_ANY_LOW));
    }
    if ((mask & nido::kDeepButtons) != nido::kDeepButtons) {
        g_recovery_seconds = nido::NextRecoverySeconds(g_recovery_seconds);
        next_wake = nido::EarlierWake(next_wake,g_recovery_seconds * 1000000ULL);
        ESP_LOGW(kTag, "button held: restore wake sources in %lus",
            static_cast<unsigned long>(g_recovery_seconds));
    } else {
        g_recovery_seconds = 0;
    }
    if (next_wake) ESP_ERROR_CHECK(esp_sleep_enable_timer_wakeup(std::max<uint64_t>(1000,next_wake)));
    ESP_LOGI(kTag, "deep_sleep wake_mask=0x%llx rtc_probe=%d wifi=off panel=off audio=off nfc=off",
        static_cast<unsigned long long>(mask), rtc_armed);
    std::fflush(stdout);
    gpio_deep_sleep_hold_en();
    esp_deep_sleep_start();
}
}  // namespace

extern "C" void app_main() {
    const esp_sleep_wakeup_cause_t cause = esp_sleep_get_wakeup_cause();
    const uint64_t wake_pins = cause == ESP_SLEEP_WAKEUP_EXT1 ?
        esp_sleep_get_ext1_wakeup_status() : 0;
    const bool cold = cause == ESP_SLEEP_WAKEUP_UNDEFINED || g_magic != kMagic;
    if (cold) {
        g_magic = kMagic;
        g_boots = 0;
        g_turns = 0;
        g_rtc_test_pending = CONFIG_NIDO_RTC_WAKE_TEST_SECONDS > 0;
        g_rtc_test_armed = false;
        g_recovery_seconds = 0;
        g_rtc_probe_result = 0;
        g_session_expires_at = 0;
    }
    ++g_boots;
    setenv("TZ","CET-1CEST,M3.5.0,M10.5.0/3",1);tzset();
    RestorePins();
    ZectrixBoardConfig config;
    config.enable_nfc = false;
    config.start_button_task = false;
    ESP_ERROR_CHECK(g_board.Init(config));
    const auto power = g_board.TickPower();
    g_low_battery = nido::ShowLowBattery(power.battery_valid,power.battery_percent);
    if (nido::DeviceEnabled()) {
        ESP_ERROR_CHECK(gpio_install_isr_service(ESP_INTR_FLAG_IRAM));
        ESP_ERROR_CHECK(gpio_set_intr_type(GPIO_NUM_39,GPIO_INTR_NEGEDGE));
        ESP_ERROR_CHECK(gpio_set_intr_type(GPIO_NUM_18,GPIO_INTR_NEGEDGE));
        ESP_ERROR_CHECK(gpio_isr_handler_add(GPIO_NUM_39,ChoiceInterrupt,reinterpret_cast<void*>(2)));
        ESP_ERROR_CHECK(gpio_isr_handler_add(GPIO_NUM_18,ChoiceInterrupt,reinterpret_cast<void*>(3)));
        gpio_intr_disable(GPIO_NUM_39); gpio_intr_disable(GPIO_NUM_18);
    }
    g_audio_events = xQueueCreate(2, sizeof(AudioEvent));
    ESP_ERROR_CHECK(g_audio_events ? ESP_OK : ESP_ERR_NO_MEM);
    ESP_LOGI(kTag, "boot=%lu wake=%d pins=0x%llx firmware=%s",
        static_cast<unsigned long>(g_boots), cause,
        static_cast<unsigned long long>(wake_pins),nido::DeviceVersion());
    if (RtcPcf8563* rtc = g_board.rtc()) {
        tm clock{};
        const bool valid = rtc->GetTime(clock);
        if(valid && clock.tm_year>=120){const time_t stamp=nido::UtcSeconds(clock);timeval now{stamp,0};settimeofday(&now,nullptr);}
        char stamp[32] = "not set";
        if (valid) std::strftime(stamp, sizeof(stamp), "%Y-%m-%dT%H:%M:%S", &clock);
        const bool fired = rtc->IsTimerFired();
        ESP_LOGI(kTag, "rtc=%s timer_fired=%d", stamp, fired);
        if (g_rtc_test_armed) {
            g_rtc_probe_result = (wake_pins & nido::kRtc) && fired ? 1 : 2;
            ESP_LOGI(kTag, "rtc_probe=%s", (wake_pins & nido::kRtc) && fired ?
                "interrupt received" : "interrupted or fallback timer");
        }
    }
    g_board.ReleaseAudio();
    g_network_events=xQueueCreate(8,sizeof(NetworkEvent*));ESP_ERROR_CHECK(g_network_events ? ESP_OK : ESP_ERR_NO_MEM);
    g_home_events=xQueueCreate(1,sizeof(HomeRequest*));ESP_ERROR_CHECK(g_home_events ? ESP_OK : ESP_ERR_NO_MEM);
    // Confirm only after board, queues, panel and persistent configuration initialize.
    const bool configured=nido::DeviceConfigured();

    if(nido::DeviceEnabled()) {
        g_boot_display.Begin(configured);
        DrawCurrent();
        // Reset/select the controller and check BUSY without sending any refresh.
        // Boot validation must not depend on Wi-Fi or overwrite retained e-paper.
        if(configured && PreparePanel()==ESP_OK)nido::DeviceConfirmFirmware();
        if(!configured)RunMaintenance();
        if(MaintenanceChord() && g_request_maintenance)RunMaintenance();
        // A front wake starts audio first. Cold boots without a press fetch the daily view.
        if(FrontHeld())Record();else if(nido::DeviceConfigured()){StartHomeSync(true);ESP_ERROR_CHECK_WITHOUT_ABORT(Paint());}
        bool front_armed=!FrontHeld(),upper_armed=gpio_get_level(GPIO_NUM_39)!=0,lower_armed=gpio_get_level(GPIO_NUM_18)!=0;
        bool unconfigured_notice=false;
        for(;;) {
            nido::DeviceBootGuard();
            if((FrontHeld() && gpio_get_level(GPIO_NUM_18)==0) || g_request_maintenance) {
                g_request_maintenance=false;
                const bool consumed=MaintenanceChord();
                if(g_request_maintenance)RunMaintenance();
                if(consumed){front_armed=false;lower_armed=false;continue;}
            }
            if(!nido::DeviceConfigured()) {
                if(!unconfigured_notice){MaintenanceMessage("Nido sin configurar","Mantén frontal + inferior cinco segundos para conectar Nido.");unconfigured_notice=true;}
                if(FrontHeld() || gpio_get_level(GPIO_NUM_18)==0)vTaskDelay(pdMS_TO_TICKS(20));
                else WaitForInput(esp_timer_get_time()+1000000);
                continue;
            }
            unconfigured_notice=false;
            DrainNetwork();
            if(FinishHomeSync())ESP_ERROR_CHECK_WITHOUT_ABORT(Paint());
            if(g_check_update && !g_sync_active && !g_network_active && g_network_jobs.empty() && !g_flow.modal() && !FrontHeld()) {
                g_check_update=false;nido::DeviceCheckUpdate(MaintenancePower,FirmwarePaint);DrawCurrent();ESP_ERROR_CHECK_WITHOUT_ABORT(Paint());
            }
            if(g_session_expires_at && SessionRemaining()==0 && !g_flow.busy()) {
                g_session_expires_at=0;g_flow.Dispatch(nido::UiEvent::Expire);g_catching_buttons=false;g_button_latched=0;
                LocalToday();std::strcpy(g_selected_date,g_today);DrawCurrent();ESP_ERROR_CHECK_WITHOUT_ABORT(Paint());
            }
            if(!g_sync_active && !g_network_active && esp_timer_get_time()>=g_next_sync_us){StartHomeSync();ESP_ERROR_CHECK_WITHOUT_ABORT(Paint());}
            int choice=0;
            if(!FrontHeld())front_armed=true;else if(front_armed){choice=1;front_armed=false;}
            if(g_button_latched){choice=g_button_latched;g_button_latched=0;}
            if(gpio_get_level(GPIO_NUM_39))upper_armed=true;else if(upper_armed){choice=2;upper_armed=false;}
            if(gpio_get_level(GPIO_NUM_18))lower_armed=true;else if(lower_armed){choice=3;lower_armed=false;}
            if(choice==1){Record();continue;}
            if(choice==2||choice==3) {
                if(g_flow.mode==nido::UiMode::Question && std::strcmp(g_modal_card.type,"binary")==0) {
                    WaitHomeSync();g_flow.Dispatch(nido::UiEvent::SendAudio);
                    auto* job=new NetworkJob;job->answer=true;job->upper=choice==2;
                    std::strcpy(job->turn,g_question_turn);std::strcpy(job->card,g_question_card);
                    g_network_jobs.push_back(job);StartNextNetwork();
                } else if(!g_flow.modal()) {
                    const char* base=*g_selected_date ? g_selected_date : g_home.today;
                    if(nido::ValidHomeDate(base)) {
                        tm d{};int y,m,day;std::sscanf(base,"%d-%d-%d",&y,&m,&day);d.tm_year=y-1900;d.tm_mon=m-1;d.tm_mday=day+(choice==2?-1:1);d.tm_hour=12;
                        const time_t stamp=nido::UtcSeconds(d);tm shifted{};gmtime_r(&stamp,&shifted);std::strftime(g_selected_date,sizeof(g_selected_date),"%Y-%m-%d",&shifted);
                        if(!nido::FindHomeDay(g_home,g_selected_date) && !g_sync_active)StartHomeSync();
                        DrawCurrent();ESP_ERROR_CHECK_WITHOUT_ABORT(Paint());
                    }
                }
                continue;
            }
            nido::DeviceWifiIdle(g_network_active || (g_session_expires_at && SessionRemaining()>0));
            if(g_sync_active || g_network_active || nido::DeviceWifiAwake()){vTaskDelay(pdMS_TO_TICKS(10));continue;}
            int64_t deadline=g_next_sync_us;
            if(g_session_expires_at)deadline=std::min(deadline,esp_timer_get_time()+SessionRemaining());
            choice=WaitForInput(std::max<int64_t>(esp_timer_get_time()+1000,deadline));
            if(choice==1){front_armed=false;Record();}
            else if(choice==2||choice==3){g_button_latched=choice;}
        }
    }
    if(cold){nido::DrawReady(g_canvas,false);if(Paint()==ESP_OK)nido::DeviceConfirmFirmware();}
    const bool front_wake=(wake_pins & nido::kFront)!=0;
    if(cold || front_wake || (wake_pins & nido::kDown)) {
        if(FrontHeld() || WaitForFront(nido::kIdleMs)){Record();vTaskDelay(pdMS_TO_TICKS(nido::kResultMs));}
    }
    DeepSleep();
}
