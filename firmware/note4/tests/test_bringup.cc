#include <array>
#include <cassert>
#include <cstdio>
#include <cstring>
#include <fstream>
#include <string>
#include "nido_card.h"
#include "cJSON.h"
#include "nido_power_policy.h"
#include "nido_screens.h"

namespace {
void WritePgm(const char* path, const HearthCanvas& canvas) {
    FILE* file = std::fopen(path, "wb");
    assert(file);
    std::fprintf(file, "P5\n400 300\n255\n");
    for (int y = 0; y < 300; ++y) {
        for (int x = 0; x < 400; ++x) {
            std::fputc(canvas.data()[y * 50 + x / 8] & (0x80 >> (x % 8)) ? 255 : 0, file);
        }
    }
    std::fclose(file);
}
}

int main(int argc, char** argv) {
    using namespace nido;
    assert(DeepWakeMask(kLightButtons | kRtc, false) == kDeepButtons);
    assert(DeepWakeMask(kLightButtons | kRtc, true) == (kDeepButtons | kRtc));
    assert(DeepWakeMask(kDown | kUp, true) == kDown); // held front and RTC
    assert(DeepWakeMask(kUp, false) == 0); // upper cannot wake deep sleep
    assert(NextRecoverySeconds(0) == 2);
    assert(NextRecoverySeconds(2) == 4);
    assert(NextRecoverySeconds(32) == 60);
    assert(NextRecoverySeconds(60) == 60);
    assert(ShowLowBattery(true,19));
    assert(!ShowLowBattery(true,20));
    assert(!ShowLowBattery(false,0));
    assert(SessionRemainingUs(1300,1000000000) == 300000000);
    assert(SessionRemainingUs(1300,1299999000) == 1000);
    assert(SessionRemainingUs(1300,1300000000) == 0);
    assert(SessionRemainingUs(0,1000000000) == 0);
    assert(EarlierWake(300000000,2000000) == 2000000);
    assert(EarlierWake(2000000,300000000) == 2000000);
    assert(EarlierWake(0,300000000) == 300000000);
    assert(EarlierWake(0,0) == 0);
    const std::array<int16_t, 4> edge{-32768, 32767, 0, 0};
    const auto summary = SummarizePcm(edge.data(), edge.size(), 4);
    assert(summary.duration_ms == 1000 && summary.peak == 32768);
    assert(summary.rms == 23170 && summary.has_signal);
    const std::array<int16_t, 1600> silence{};
    assert(!SummarizePcm(silence.data(), silence.size(), 16000).has_signal);
    assert(SummarizePcm(nullptr, 100, 16000).duration_ms == 0);
    assert(SummarizePcm(edge.data(), edge.size(), 0).duration_ms == 0);
    HearthCanvas canvas;
    assert(canvas.TextWidth("grabación") == canvas.TextWidth("grabacion"));
    assert(canvas.TextWidth("niño") == canvas.TextWidth("nino"));
    assert(canvas.TextWidth("🙂") == canvas.TextWidth("?"));
    assert(canvas.TextWidth("\xc3") == canvas.TextWidth("?"));
    assert(canvas.TextWidth("\xe0\x80\x80") == canvas.TextWidth("?"));
    canvas.Clear();
    canvas.Text(0, 0, "niño");
    const auto accented = canvas;
    canvas.Clear();
    canvas.Text(0, 0, "nino");
    assert(std::memcmp(canvas.data(), accented.data(), canvas.size()) != 0);
    canvas.Clear(); canvas.Text(0,0,"…");
    const auto ellipsis = canvas;
    canvas.Clear(); canvas.Text(0,0,"?");
    assert(std::memcmp(canvas.data(),ellipsis.data(),canvas.size()) != 0);
    // Ellipsis is exactly three dots, not a replacement punctuation symbol.
    int ink=0;
    for (size_t i=0;i<ellipsis.size();++i) {
        unsigned char bits=static_cast<unsigned char>(~ellipsis.data()[i]);
        while (bits) { ink+=bits & 1; bits>>=1; }
    }
    assert(ink==3);
    // Out-of-bounds drawing must not touch storage or crash.
    canvas.Text(395, 297, "áéíóúüñ¿¡🙂", 2);
    // Adding either header icon must preserve the logo and request-state badge.
    DeviceCard header = {};
    std::strcpy(header.status,"question"); std::strcpy(header.type,"text");
    std::strcpy(header.title,"Una pregunta");
    DrawDeviceCard(canvas,header); const auto header_before=canvas;
    DrawStatusIcons(canvas,true,false);
    for (int y=0;y<56;++y) for (int x=0;x<400;++x) {
        if (x>=172 && x<231 && y>=16 && y<42) continue;
        const int offset=y*50+x/8, mask=0x80>>(x%8);
        assert((canvas.data()[offset] & mask)==(header_before.data()[offset] & mask));
    }
    // Maximum-length unbroken text exercises truncation, row height and bounds.
    // Compare against the empty card so its frame and shadow must stay intact.
    DeviceCard overflow = {};
    std::strcpy(overflow.status,"done"); std::strcpy(overflow.type,"text");
    DrawDeviceCard(canvas,overflow);
    const auto empty_card=canvas;
    std::memset(overflow.title,'W',sizeof(overflow.title)-1);
    std::memset(overflow.body,'W',sizeof(overflow.body)-1);
    DrawDeviceCard(canvas,overflow);
    for (int y=64;y<300;++y) {
        for (int x=0;x<400;++x) {
            if (x>=28 && x<372 && y<280) continue;
            const int offset=y*50+x/8, mask=0x80>>(x%8);
            assert((canvas.data()[offset] & mask)==(empty_card.data()[offset] & mask));
        }
    }
    if (argc >= 2) {
        char path[1024];
        DrawReady(canvas);
        std::snprintf(path, sizeof(path), "%s/ready.pgm", argv[1]);
        WritePgm(path, canvas);
        DeviceCard question = {};
        std::strcpy(question.status,"question"); std::strcpy(question.type,"binary");
        std::strcpy(question.title,"¿Cambio la cena de mañana?");
        std::strcpy(question.body,"Puedo sustituir la merluza por tortilla con pimientos. ¿Lo hago?");
        std::strcpy(question.labels[0],"Sí, cambiarla"); std::strcpy(question.labels[1],"No, conservarla");
        DrawDeviceCard(canvas,question);
        std::snprintf(path,sizeof(path),"%s/binary.pgm",argv[1]); WritePgm(path,canvas);
        DeviceCard meal = {};
        std::strcpy(meal.status,"done"); std::strcpy(meal.type,"meal_change");
        std::strcpy(meal.title,"Cena actualizada"); std::strcpy(meal.date,"2026-09-30");
        std::strcpy(meal.meal,"cena"); std::strcpy(meal.before,"Merluza con patatas y judías verdes");
        std::strcpy(meal.after,"Tortilla con pimientos y ensalada");
        DrawDeviceCard(canvas,meal);
        std::snprintf(path,sizeof(path),"%s/meal-change.pgm",argv[1]); WritePgm(path,canvas);
        DeviceCard event = {};
        std::strcpy(event.status,"done"); std::strcpy(event.type,"event");
        std::strcpy(event.title,"Evento añadido"); std::strcpy(event.summary,"Reunión de I2");
        std::strcpy(event.date,"2026-10-15"); std::strcpy(event.end_date,"2026-10-15");
        std::strcpy(event.start_time,"17:00"); std::strcpy(event.end_time,"18:00");
        std::strcpy(event.location,"L'escola bressol"); event.duration_estimated = true;
        DrawDeviceCard(canvas,event);
        DrawStatusIcons(canvas,true,true);
        std::snprintf(path,sizeof(path),"%s/event.pgm",argv[1]); WritePgm(path,canvas);
        std::strcpy(event.title,"Horario actualizado"); std::strcpy(event.start_time,"18:30");
        std::strcpy(event.end_time,"19:15"); event.duration_estimated = false;
        DrawDeviceCard(canvas,event);
        std::snprintf(path,sizeof(path),"%s/event-updated.pgm",argv[1]); WritePgm(path,canvas);
        event.all_day = true; event.start_time[0] = 0; event.end_time[0] = 0;
        std::strcpy(event.title,"Evento añadido");
        std::strcpy(event.summary,"Jornada familiar en la escuela infantil");
        std::strcpy(event.end_date,"2026-10-17");
        std::strcpy(event.location,"Escuela infantil · edificio principal, sala de reuniones de las familias");
        DrawDeviceCard(canvas,event);
        std::snprintf(path,sizeof(path),"%s/event-all-day.pgm",argv[1]); WritePgm(path,canvas);
        event.all_day = false;
        std::strcpy(event.summary,"Visita nocturna");
        std::strcpy(event.start_time,"23:30"); std::strcpy(event.end_time,"00:30");
        std::strcpy(event.end_date,"2026-10-16"); event.location[0] = 0;
        DrawDeviceCard(canvas,event);
        std::snprintf(path,sizeof(path),"%s/event-overnight.pgm",argv[1]); WritePgm(path,canvas);
        DrawReady(canvas,true); DrawStatusIcons(canvas,false,true);
        std::snprintf(path,sizeof(path),"%s/home.pgm",argv[1]); WritePgm(path,canvas);
        DeviceCard text = {};
        std::strcpy(text.status,"progress"); std::strcpy(text.type,"text");
        std::strcpy(text.title,"Conectando con Nido");
        std::strcpy(text.body,"Estoy enviando tu petición…");
        DrawDeviceCard(canvas,text);
        std::snprintf(path,sizeof(path),"%s/connecting.pgm",argv[1]); WritePgm(path,canvas);
        DrawListening(canvas,true);
        std::snprintf(path,sizeof(path),"%s/listening-connected.pgm",argv[1]); WritePgm(path,canvas);
        std::strcpy(text.status,"error"); std::strcpy(text.title,"Sin Wi-Fi");
        std::strcpy(text.body,"No he podido conectar con la red.");
        DrawDeviceCard(canvas,text); DrawStatusIcons(canvas,true,false);
        std::snprintf(path,sizeof(path),"%s/header-icons.pgm",argv[1]); WritePgm(path,canvas);
        DrawDeviceError(canvas,false);
        std::snprintf(path,sizeof(path),"%s/connection-error.pgm",argv[1]); WritePgm(path,canvas);
        DrawDeviceError(canvas,true);
        std::snprintf(path,sizeof(path),"%s/uncertain.pgm",argv[1]); WritePgm(path,canvas);
        std::strcpy(text.status,"done");
        std::strcpy(text.title,"Todo preparado para el fin de semana");
        std::strcpy(text.body,"He organizado las comidas de los próximos días con lo que tenemos en casa. El viernes habrá tortilla con ensalada, el sábado prepararemos arroz con verduras y el domingo una crema de calabaza. También he añadido la reunión del colegio al calendario familiar. Este texto extra permite revisar que una respuesta larga termina con puntos suspensivos dentro de la tarjeta, sin invadir la sombra ni el borde inferior.");
        DrawDeviceCard(canvas,text);
        std::snprintf(path,sizeof(path),"%s/long-text.pgm",argv[1]); WritePgm(path,canvas);
        std::strcpy(question.labels[0],"Sí, cambiar la cena por tortilla con pimientos y ensalada");
        std::strcpy(question.labels[1],"No, conservar la merluza con patatas y judías verdes");
        DrawDeviceCard(canvas,question);
        std::snprintf(path,sizeof(path),"%s/binary-long.pgm",argv[1]); WritePgm(path,canvas);
        DrawListening(canvas);
        std::snprintf(path, sizeof(path), "%s/listening.pgm", argv[1]);
        WritePgm(path, canvas);
        DrawRecorded(canvas, {2400, 12500, 1700, true}, false, false);
        std::snprintf(path, sizeof(path), "%s/recorded.pgm", argv[1]);
        WritePgm(path, canvas);
        DrawRecorded(canvas, {}, false, true);
        std::snprintf(path, sizeof(path), "%s/error.pgm", argv[1]);
        WritePgm(path, canvas);
    }
    if (argc >= 3) {
        std::ifstream input(argv[2]);
        assert(input);
        const std::string json((std::istreambuf_iterator<char>(input)),std::istreambuf_iterator<char>());
        cJSON* examples=cJSON_Parse(json.c_str());
        assert(cJSON_IsArray(examples));
        for (int i=0;i<cJSON_GetArraySize(examples);++i) {
            cJSON* example=cJSON_GetArrayItem(examples,i);
            cJSON* card_json=cJSON_GetObjectItemCaseSensitive(example,"card");
            const char* name=cJSON_GetObjectItemCaseSensitive(example,"name")->valuestring;
            DeviceCard decoded={};
            assert(ParseDeviceCard(card_json,decoded));
            const auto original=decoded;
            // A malformed array must fail atomically, leaving the old card intact.
            cJSON* broken=cJSON_Duplicate(card_json,true);
            cJSON* view=cJSON_GetObjectItemCaseSensitive(broken,"view");
            cJSON_ReplaceItemInObjectCaseSensitive(view,"type",cJSON_CreateString("unknown"));
            assert(!ParseDeviceCard(broken,decoded));
            assert(std::memcmp(&original,&decoded,sizeof(decoded))==0);
            cJSON_Delete(broken);
            // All new view content must stay inside the shared content rectangle.
            DeviceCard blank={}; std::strcpy(blank.status,decoded.status); std::strcpy(blank.type,"text");
            DrawDeviceCard(canvas,blank); const auto frame=canvas;
            DrawDeviceCard(canvas,decoded);
            for (int y=64;y<300;++y) for (int x=0;x<400;++x) {
                if (x>=28 && x<372 && y<280) continue;
                const int offset=y*50+x/8, mask=0x80>>(x%8);
                assert((canvas.data()[offset] & mask)==(frame.data()[offset] & mask));
            }
            char path[1024];
            std::snprintf(path,sizeof(path),"%s/%s.pgm",argv[1],name); WritePgm(path,canvas);
        }
        cJSON_Delete(examples);
        // Oversized arrays and strings must never overflow fixed device buffers.
        for (const char* bad : {
            R"({"cardId":"x","title":"x","status":"done","view":{"type":"list","items":[]}})",
            R"({"cardId":"x","title":"x","status":"done","view":{"type":"facts","items":[{}, {}, {}, {}]}})",
            R"({"cardId":"x","title":"x","status":"question","view":{"type":"highlight","value":"x","caption":"x"}})",
            R"({"cardId":"x","title":"x","status":"done","view":{"type":"list","items":[{"label":"x","detail":42}]}})"
        }) {
            cJSON* object=cJSON_Parse(bad); DeviceCard decoded={};
            assert(!ParseDeviceCard(object,decoded)); cJSON_Delete(object);
        }
    }
    std::puts("NOTE4: wake guards, PCM boundaries, UTF-8 and rendering passed");
}
