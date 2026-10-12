#include "nido_screens.h"
#include "nido_config.h"
#include "nido_github_policy.h"
#include "nido_portal.h"
#include "nido_small_font.h"
#include "nido_ui.h"
#include "nido_date.h"
#include "cJSON.h"
#include <cassert>
#include <cstdio>
#include <cstring>
#include <memory>
#include <string>
void Save(const std::string& path,const HearthCanvas& canvas) {
    FILE* f=std::fopen(path.c_str(),"wb");assert(f);std::fprintf(f,"P5\n400 300\n255\n");
    for(int y=0;y<300;++y)for(int x=0;x<400;++x)std::fputc(canvas.data()[y*50+x/8]&(0x80>>(x%8))?255:0,f);
    std::fclose(f);
}
int main(int argc,char** argv) {
    using namespace nido;
    sockaddr_storage address{};sockaddr_in v4{};v4.sin_family=AF_INET;
    const uint8_t ap[4]={192,168,4,1};std::memcpy(&v4.sin_addr,ap,4);std::memcpy(&address,&v4,sizeof(v4));
    assert(MaintenanceAddress(address,sizeof(v4)));assert(!MaintenanceAddress(address,sizeof(v4)-1));
    sockaddr_in6 v6{};v6.sin6_family=AF_INET6;
    uint8_t mapped[16]={0,0,0,0,0,0,0,0,0,0,255,255,192,168,4,1};
    std::memcpy(&v6.sin6_addr,mapped,16);std::memcpy(&address,&v6,sizeof(v6));
    assert(MaintenanceAddress(address,sizeof(v6)));assert(!MaintenanceAddress(address,sizeof(v4)));
    mapped[14]=1;std::memcpy(&v6.sin6_addr,mapped,16);std::memcpy(&address,&v6,sizeof(v6));
    assert(!MaintenanceAddress(address,sizeof(v6)));
    mapped[14]=4;mapped[10]=0;std::memcpy(&v6.sin6_addr,mapped,16);std::memcpy(&address,&v6,sizeof(v6));assert(!MaintenanceAddress(address,sizeof(v6)));
    uint8_t dns[512]={0x12,0x34,1,0,0,1,0,0,0,0,0,0,1,'a',0,0,1,0,1};
    uint8_t query[19];std::memcpy(query,dns,19);
    assert(PortalDns(dns,19,sizeof(dns))==35);assert(dns[7]==1 && std::memcmp(dns+31,ap,4)==0);
    std::memcpy(dns,query,19);dns[16]=28;assert(PortalDns(dns,19,sizeof(dns))==19 && dns[7]==0);
    for(size_t length=0;length<19;++length){std::memcpy(dns,query,19);assert(PortalDns(dns,length,sizeof(dns))==0);}
    std::memcpy(dns,query,19);dns[12]=0xc0;assert(PortalDns(dns,19,sizeof(dns))==0);
    std::memcpy(dns,query,19);assert(PortalDns(dns,19,20)==0);
    const uint8_t factory_mac[6]={0x02,0,0,0xa1,0xb2,0xc3};
    assert(MaintenanceSsid(factory_mac)=="Nido-A1B2C3");
    MaintenanceGesture gesture;
    assert(!gesture.Tick(true,true,0));assert(!gesture.Tick(true,true,4999));assert(!gesture.Tick(true,false,5000));
    assert(!gesture.Tick(true,true,6000));assert(!gesture.Tick(true,true,11000));assert(gesture.ready);
    assert(!gesture.Tick(false,true,11001));assert(gesture.Tick(false,false,11002));assert(!gesture.Tick(false,false,11003));
    assert(UpdatePowerAllowed(false,0,true));assert(!UpdatePowerAllowed(false,100,false));assert(!UpdatePowerAllowed(true,39,false));assert(UpdatePowerAllowed(true,40,false));
    assert(LocalEndpoint("https://192.168.1.2:18791"));assert(!LocalEndpoint("https://192.168.1.2:0"));assert(!LocalEndpoint("https://8.8.8.8"));assert(!LocalEndpoint("http://192.168.1.2"));assert(!LocalEndpoint("https://192.168.1.2/evil"));
    RuntimeConfig wifi;wifi.ssid="Red ficticia";wifi.password="password-demo";
    cJSON* wifi_json=cJSON_Parse(ConfigJson(wifi).c_str());RuntimeConfig wifi_loaded;
    assert(ParseRuntimeConfig(wifi_json,wifi_loaded,false));assert(wifi_loaded.ssid==wifi.ssid && !wifi_loaded.configured());
    assert(!ParseRuntimeConfig(wifi_json,wifi_loaded,true));
    cJSON_ReplaceItemInObject(wifi_json,"endpoint",cJSON_CreateString("https://192.168.1.2"));
    assert(!ParseRuntimeConfig(wifi_json,wifi_loaded,false));cJSON_Delete(wifi_json);
    RuntimeConfig config;config.ssid="Red ficticia";config.password="password-demo";config.endpoint="https://192.168.1.2:18791";config.certificate="-----BEGIN CERTIFICATE-----demo";config.token=std::string(64,'a');config.device_id="note4-demo";
    cJSON* configuration=cJSON_Parse(ConfigJson(config).c_str());RuntimeConfig parsed;assert(ParseRuntimeConfig(configuration,parsed,false));assert(parsed.token==config.token);
    cJSON_ReplaceItemInObject(configuration,"schema",cJSON_CreateNumber(2));assert(!ParseRuntimeConfig(configuration,parsed,false));assert(parsed.token==config.token);cJSON_Delete(configuration);
    assert(IsFrontClick(100000,true,0));
    assert(!IsFrontClick(200000,true,0));
    assert(!IsFrontClick(100000,true,1600)); // Captured speech must never cancel.
    assert(!IsFrontClick(100000,false,0));
    assert(IsAccidentalRecording(0,16000));
    assert(IsAccidentalRecording(15999,16000));
    assert(!IsAccidentalRecording(16000,16000));
    assert(!IsAccidentalRecording(16001,16000));
    assert(TextTinyWidth("Álex")==16);assert(TextTinyWidth("Família")==28);
    HearthCanvas tiny;tiny.Clear();TextTiny(tiny,10,10,"Álex");
    // A label must fit its 4x7 cells, including accents.
    for(int y=0;y<300;++y)for(int x=0;x<400;++x)
        if(!(tiny.data()[y*50+x/8]&(0x80>>(x%8))))assert(x>=10 && x<26 && y>=10 && y<17);
    assert(CivilDays(1970,1,1)==0);assert(CivilDays(2026,10,0)==CivilDays(2026,9,30));
    assert(CivilDays(2026,10,32)==CivilDays(2026,11,1));assert(CivilDays(2026,10,26)-CivilDays(2026,10,25)==1);
    assert(!ValidHomeDate("2026-02-30"));assert(ValidHomeDate("2028-02-29"));assert(!ValidHomeDate("2026-02-29"));
    UiFlow flow;flow.Dispatch(UiEvent::Press);assert(flow.busy());flow.Dispatch(UiEvent::Expire);assert(flow.mode==UiMode::Capturing);
    flow.Dispatch(UiEvent::Click);assert(!flow.modal());flow.Dispatch(UiEvent::Press);flow.Dispatch(UiEvent::SendAudio);flow.Dispatch(UiEvent::Ask);assert(flow.mode==UiMode::Question);
    flow.Dispatch(UiEvent::SendAudio);flow.Dispatch(UiEvent::Unknown);assert(flow.mode==UiMode::Uncertain);flow.Dispatch(UiEvent::Expire);assert(flow.mode==UiMode::Day);
    flow.Dispatch(UiEvent::Press);flow.Dispatch(UiEvent::SendAudio);
    flow.Dispatch(UiEvent::Press);assert(flow.mode==UiMode::Capturing);
    flow.Dispatch(UiEvent::SendAudio);assert(flow.mode==UiMode::Processing);
    // Malformed payloads may never replace the previous cached day.
    auto home=std::make_unique<HomeSnapshot>();std::strcpy(home->today,"2026-10-02");
    cJSON* root=cJSON_Parse("{\"today\":\"2026-10-02\",\"serverTime\":1790942400,\"demo\":false,\"days\":[]}");
    assert(!ParseHome(root,*home));assert(std::strcmp(home->today,"2026-10-02")==0);cJSON_Delete(root);
    root=cJSON_CreateObject();cJSON_AddStringToObject(root,"today","2026-10-02");cJSON_AddNumberToObject(root,"serverTime",1790942400);cJSON_AddBoolToObject(root,"demo",false);
    cJSON* days=cJSON_AddArrayToObject(root,"days");
    for(int i=0;i<15;++i){cJSON* day=cJSON_CreateObject();char date[11];std::snprintf(date,sizeof(date),"2026-10-%02d",i+1);
        cJSON_AddStringToObject(day,"date",date);cJSON_AddStringToObject(day,"label","viernes 02 oct");cJSON_AddStringToObject(day,"lunch","Lentejas con verduras");cJSON_AddStringToObject(day,"dinner","Tortilla y ensalada");cJSON_AddNumberToObject(day,"more",0);cJSON_AddArrayToObject(day,"events");cJSON_AddItemToArray(days,day);}
    cJSON* span=cJSON_CreateObject();cJSON_AddStringToObject(span,"summary","Viaje");
    cJSON_AddStringToObject(span,"time","18:00–10:00");cJSON_AddBoolToObject(span,"allDay",false);
    cJSON_AddStringToObject(span,"calendarLabel","Casa");cJSON_AddStringToObject(span,"key","trip");cJSON_AddStringToObject(span,"startDate","2026-09-30");
    cJSON_AddStringToObject(span,"endDate","2026-10-03");
    cJSON_AddItemToArray(cJSON_GetObjectItem(cJSON_GetArrayItem(days,0),"events"),span);
    assert(ParseHome(root,*home));assert(std::strcmp(home->days[0].events[0].end_date,"2026-10-03")==0);assert(std::strcmp(home->days[0].events[0].calendar_label,"Casa")==0);auto saved=*home;
    assert(!home->days[0].lunch_past && !home->days[0].dinner_past); // Older bridge defaults.
    auto* first_day=cJSON_GetArrayItem(days,0);cJSON_AddStringToObject(first_day,"lunchPast","true");
    assert(!ParseHome(root,*home));assert(std::memcmp(&saved,home.get(),sizeof(saved))==0);
    cJSON_ReplaceItemInObject(first_day,"lunchPast",cJSON_CreateBool(true));assert(ParseHome(root,*home));assert(home->days[0].lunch_past);
    cJSON_DeleteItemFromObject(first_day,"lunchPast");assert(ParseHome(root,*home));
    assert(!home->update_available);cJSON_AddBoolToObject(root,"updateAvailable",true);assert(ParseHome(root,*home));assert(home->update_available);
    cJSON_DeleteItemFromObject(root,"updateAvailable");assert(ParseHome(root,*home));assert(!home->update_available);
    cJSON_ReplaceItemInObject(span,"calendarLabel",cJSON_CreateString(std::string(65,'x').c_str()));assert(!ParseHome(root,*home));assert(std::memcmp(&saved,home.get(),sizeof(saved))==0);
    cJSON_ReplaceItemInObject(span,"calendarLabel",cJSON_CreateString("Casa"));
    cJSON_ReplaceItemInObject(cJSON_GetArrayItem(days,0),"date",cJSON_CreateString("2026-02-30"));assert(!ParseHome(root,*home));assert(std::memcmp(&saved,home.get(),sizeof(saved))==0);cJSON_Delete(root);
    HearthCanvas canvas,background;
    HomeDay day=home->days[1];
    const char* names[]={"Día sin cole","Cumple de Lucía","Parque","Visita a abuelos","Natación","Cine"};
    for(int i=0;i<6;++i){std::strcpy(day.events[i].summary,names[i]);std::strcpy(day.events[i].time,i<2 ? "todo el día" : "17:00–18:00");day.events[i].all_day=i<2;}
    const char* calendars[]={"Escuela","Casa","Álex","Familia","Blanca","Casa"};
    for(int i=0;i<6;++i)std::strcpy(day.events[i].calendar_label,calendars[i]);
    for(int count=0;count<=6;++count){day.event_count=count;DrawHome(canvas,&day,home->today);if(argc>1)Save(std::string(argv[1])+"/daily-"+std::to_string(count)+".pgm",canvas);}
    DrawHome(canvas,&day,home->today);HearthCanvas before_meals=canvas;
    day.lunch_past=true;DrawHome(canvas,&day,home->today);
    assert(std::memcmp(canvas.data(),before_meals.data(),15000)!=0);
    // Dimming changes only decoration, never meal text or the agenda.
    assert(std::memcmp(canvas.data()+49*50+4,before_meals.data()+49*50+4,19)==0);
    for(int y=68;y<100;++y)assert(std::memcmp(canvas.data()+y*50+4,before_meals.data()+y*50+4,19)==0);
    assert(std::memcmp(canvas.data()+118*50,before_meals.data()+118*50,182*50)==0);
    if(argc>1)Save(std::string(argv[1])+"/daily-lunch-past.pgm",canvas);
    day.dinner_past=true;DrawHome(canvas,&day,home->today);if(argc>1)Save(std::string(argv[1])+"/daily-meals-past.pgm",canvas);
    DrawHome(canvas,&day,"2026-10-03");day.lunch_past=day.dinner_past=false;DrawHome(before_meals,&day,"2026-10-03");
    assert(std::memcmp(canvas.data(),before_meals.data(),15000)==0);
    home->update_available=true;DrawHome(canvas,&day,home->today,false,false,false,false,home.get());
    if(argc>1)Save(std::string(argv[1])+"/daily-update-available.pgm",canvas);
    home->update_available=false;
    DrawHome(background,&day,home->today);DeviceCard card={};std::strcpy(card.status,"question");std::strcpy(card.type,"binary");std::strcpy(card.title,"¿Cambio la cena?");std::strcpy(card.body,"Puedo sustituir la tortilla por sopa de verduras.");std::strcpy(card.labels[0],"Sí, cambiarla");std::strcpy(card.labels[1],"No, conservarla");
    DrawModal(canvas,background,card);
    assert(std::memcmp(canvas.data(),background.data(),34*50)!=0); // The veil includes the header.
    HearthCanvas veil=background;
    for(int y=0;y<300;++y)for(int x=0;x<400;++x)if((x+y)%4==0 && y%2==0)veil.Pixel(x,y,true);
    assert(std::memcmp(canvas.data(),veil.data(),53*50)==0); // Centered modal starts at y=53.
    assert(std::memcmp(canvas.data()+251*50,veil.data()+251*50,49*50)==0);
    if(argc>1)Save(std::string(argv[1])+"/daily-modal-question.pgm",canvas);
    std::strcpy(card.labels[0],"Sí, aplicar todos los cambios propuestos");std::strcpy(card.labels[1],"No, conservar la configuración anterior");DrawModal(canvas,background,card);
    if(argc>1)Save(std::string(argv[1])+"/daily-modal-buttons-long.pgm",canvas);
    std::strcpy(card.title,"¿Quieres aplicar estos cambios al menú de la próxima semana?");
    std::strcpy(card.labels[1],"No, conservar todas las opciones del menú tal como estaban antes");DrawModal(canvas,background,card);
    if(argc>1)Save(std::string(argv[1])+"/daily-modal-buttons-both-long.pgm",canvas);
    std::strcpy(card.labels[0],"Sí");DrawModal(canvas,background,card);
    if(argc>1)Save(std::string(argv[1])+"/daily-modal-buttons-second-long.pgm",canvas);
    canvas.Clear();DrawButtonSymbol(canvas,30,30,ButtonSymbol::Upper);DrawButtonSymbol(canvas,70,30,ButtonSymbol::Lower);DrawButtonSymbol(canvas,110,31,ButtonSymbol::Front);
    DrawButtonSymbol(canvas,170,31,ButtonSymbol::Front);TextSmall(canvas,198,37,"+");DrawButtonSymbol(canvas,218,30,ButtonSymbol::Lower);TextSmall(canvas,240,37,"mantener 5 s");
    if(argc>1)Save(std::string(argv[1])+"/button-symbols.pgm",canvas);
    std::strcpy(card.status,"error");std::strcpy(card.type,"text");std::strcpy(card.title,"Revisar resultado");std::strcpy(card.body,"No he podido confirmar el resultado. Puede haberse guardado. Pide que lo compruebe.");DrawModal(canvas,background,card);
    if(argc>1)Save(std::string(argv[1])+"/daily-modal-error.pgm",canvas);
    std::strcpy(card.status,"progress");std::strcpy(card.title,"Configurar Nido");std::strcpy(card.body,"red: Nido-DEMO\nclave: 012345abcdef\nAbre http://192.168.4.1\nFrontal + inferior: salir");DrawModal(canvas,background,card);
    assert(DrawMaintenance(canvas,background,"Nido-A1B2C3","nido-ota-0.4.7"));
    if(argc>1)Save(std::string(argv[1])+"/daily-modal-maintenance.pgm",canvas);
    std::strcpy(card.title,"Vincular con Nido");std::strcpy(card.body,"Código: 123456\nEn Nido: Ajustes > Note4\nIP: 192.168.1.42\nVálido durante cinco minutos");DrawModal(canvas,background,card);
    if(argc>1)Save(std::string(argv[1])+"/daily-modal-pairing.pgm",canvas);
    card={};std::strcpy(card.type,"binary");std::strcpy(card.status,"question");std::strcpy(card.title,"Nueva versión disponible");std::strcpy(card.body,"nido-ota-0.4.7\n¿Quieres instalarla ahora?");std::strcpy(card.labels[0],"Actualizar");std::strcpy(card.labels[1],"Configurar");DrawModal(canvas,background,card);
    if(argc>1)Save(std::string(argv[1])+"/daily-modal-github-update.pgm",canvas);
    assert(GithubNewer("nido-ota-0.10.0","nido-ota-0.9.0"));assert(!GithubNewer("nido-ota-0.4.2","nido-ota-0.4.3"));assert(!GithubNewer("nido-ota-0.4.3","nido-ota-0.4.3"));assert(!GithubNewer("nido-ota-0.4.","nido-ota-0.3"));assert(!GithubNewer("nido-ota-0.4.3-beta","nido-ota-0.3"));
    for(const auto* url:{"http://github.com/x","https://github.com.evil/x","https://github.com@example.com/x","https://github.com:444/x","https://127.0.0.1/x"})assert(!GithubUrl(url));
    assert(GithubUrl("https://release-assets.githubusercontent.com/asset?signature=fixture"));
    auto* release=cJSON_Parse(R"({"tag_name":"nido-ota-0.4.3","draft":false,"prerelease":false,"assets":[{"name":"firmware.nidoota","state":"uploaded","size":2048,"browser_download_url":"https://github.com/example/nido/releases/download/nido-ota-0.4.3/firmware.nidoota"}]})");
    GithubRelease found;assert(GithubParseRelease(release,"example/nido","nido-ota-0.4.2",found));assert(found.size==2048);assert(!GithubParseRelease(release,"different/nido","nido-ota-0.4.2",found));
    cJSON_ReplaceItemInObject(release,"prerelease",cJSON_CreateTrue());assert(!GithubParseRelease(release,"example/nido","nido-ota-0.4.2",found));cJSON_ReplaceItemInObject(release,"prerelease",cJSON_CreateFalse());
    auto* assets=cJSON_GetObjectItem(release,"assets");cJSON_AddItemToArray(assets,cJSON_Duplicate(cJSON_GetArrayItem(assets,0),true));assert(!GithubParseRelease(release,"example/nido","nido-ota-0.4.2",found));cJSON_Delete(release);
    home->days[1]=day;home->days[1].event_count=1;
    home->days[2]=day;std::strcpy(home->days[2].date,"2026-10-03");std::strcpy(home->days[2].label,"sábado 03 oct");home->days[2].event_count=2;home->days[2].events[0]=day.events[1];home->days[2].events[1]=day.events[2];
    home->days[3]=day;std::strcpy(home->days[3].date,"2026-10-04");std::strcpy(home->days[3].label,"domingo 04 oct");home->days[3].event_count=3;for(int i=0;i<3;++i)home->days[3].events[i]=day.events[i+3];
    DrawHome(canvas,&home->days[1],home->today,false,false,false,false,home.get());
    if(argc>1)Save(std::string(argv[1])+"/daily-future-events.pgm",canvas);
    home->days[1].event_count=0;
    home->days[2].events[0].all_day=false;
    std::strcpy(home->days[2].events[0].summary,"Cumpleaños de Lucía");
    std::strcpy(home->days[2].events[0].time,"17:00–20:00");
    DrawHome(canvas,&home->days[1],home->today,false,false,false,false,home.get());
    if(argc>1)Save(std::string(argv[1])+"/daily-empty-today-future.pgm",canvas);
    home->days[1].event_count=1;
    auto& trip=home->days[1].events[0];trip={};
    std::strcpy(trip.calendar_label,"Familia");std::strcpy(trip.key,"trip");std::strcpy(trip.summary,"Viaje en familia");
    std::strcpy(trip.start_date,"2026-10-01");std::strcpy(trip.end_date,"2026-10-03");
    std::strcpy(trip.time,"18:00–10:00");
    home->days[2].events[1]=home->days[2].events[0];home->days[2].events[0]=trip;
    DrawHome(canvas,&home->days[1],home->today,false,false,false,false,home.get());
    if(argc>1)Save(std::string(argv[1])+"/daily-multiday.pgm",canvas);
    // Repeating the same event tomorrow must not consume another grid cell.
    home->days[2].events[0]=home->days[2].events[1];home->days[2].event_count=1;
    DrawHome(background,&home->days[1],home->today,false,false,false,false,home.get());
    assert(std::memcmp(canvas.data(),background.data(),15000)==0);
    // Fictitious long multi-day titles and calendar names at every agenda density.
    HomeDay typography=day;
    typography.events[0]=trip;
    std::strcpy(typography.events[0].summary,"Vacaciones en familia");
    std::strcpy(typography.events[0].calendar_label,"Vacación familiar");
    for(int count=1;count<=6;++count) {
        typography.event_count=count;
        DrawHome(canvas,&typography,home->today);
        if(argc>1)Save(std::string(argv[1])+"/daily-multiday-long-"+std::to_string(count)+".pgm",canvas);
        HomeDay empty_title=typography;empty_title.events[0].summary[0]='\0';
        DrawHome(background,&empty_title,home->today);
        if(count==1) {
            // A title that fits keeps the main 8x16 font.
            background.Text(24,160,"Vacaciones en familia");
            assert(std::memcmp(canvas.data(),background.data(),canvas.size())==0);
        } else if(count>=5) {
            // The entire title fits in two small rows, above an unstacked footer.
            TextSmall(background,24,160,"Vacaciones en");TextSmall(background,24,172,"familia");
            assert(std::memcmp(canvas.data(),background.data(),canvas.size())==0);
        }
    }
    // Seven Unicode characters plus one compact ellipsis; shorter labels are intact.
    const char* full_labels[]={"","Casa","Família","Vacación familiar","Reunión extra","ABCDEFGHIJKLM"};
    const char* short_labels[]={"","Casa","Família","Vacació…","Reunión…","ABCDEFG…"};
    typography.events[0].summary[0]='\0';
    for(int count=1;count<=6;++count)for(bool all_day:{false,true})for(int label=0;label<6;++label) {
        typography.event_count=count;typography.events[0].all_day=all_day;
        typography.events[0].calendar_label[0]='\0';DrawHome(background,&typography,home->today);
        TextTiny(background,24,count<=3 ? 275 : 195,short_labels[label]);
        std::strcpy(typography.events[0].calendar_label,full_labels[label]);
        DrawHome(canvas,&typography,home->today);
        assert(std::memcmp(canvas.data(),background.data(),canvas.size())==0);
        assert(std::strcmp(typography.events[0].calendar_label,full_labels[label])==0);
    }
    // Short multi-day titles retain their hierarchy even in the densest grid.
    std::strcpy(typography.events[0].summary,"Viaje");
    DrawHome(canvas,&typography,home->today);
    typography.events[0].summary[0]='\0';DrawHome(background,&typography,home->today);
    background.Text(24,160,"Viaje");
    assert(std::memcmp(canvas.data(),background.data(),canvas.size())==0);
    // A multi-day event from the future cache keeps its small, crisp title.
    auto future=std::make_unique<HomeSnapshot>();future->day_count=2;
    future->days[0]=day;future->days[0].event_count=5;
    future->days[1]=typography;future->days[1].event_count=1;
    std::strcpy(future->days[1].date,"2026-10-03");
    auto& future_trip=future->days[1].events[0];future_trip.all_day=false;
    std::strcpy(future_trip.calendar_label,"Vacación familiar");
    DrawHome(background,&future->days[0],home->today,false,false,false,false,future.get());
    std::strcpy(future_trip.summary,"Vacaciones en familia");
    DrawHome(canvas,&future->days[0],home->today,false,false,false,false,future.get());
    TextSmall(background,274,240,"Vacaciones en");TextSmall(background,274,252,"familia");
    assert(std::memcmp(canvas.data(),background.data(),canvas.size())==0);
    if(argc>1)Save(std::string(argv[1])+"/daily-multiday-long-future.pgm",canvas);
    // Maximum-length unbroken titles stay between dates and footer in all layouts,
    // including an unusually wide time range that puts the calendar on its own row.
    for(int count=1;count<=6;++count)for(bool all_day:{false,true})for(bool stacked:{false,true}) {
        typography.event_count=count;typography.events[0].all_day=all_day;
        std::strcpy(typography.events[0].time,stacked ? "18:00 – 10:00" : "18:00–10:00");
        typography.events[0].summary[0]='\0';DrawHome(background,&typography,home->today);
        std::memset(typography.events[0].summary,'W',sizeof(typography.events[0].summary)-1);
        DrawHome(canvas,&typography,home->today);
        const int right=count==1 ? 376 : count==2 || count==4 ? 188 : 125;
        const int bottom=count<=3 ? 273 : stacked && !all_day && count>=5 ? 181 : 193;
        bool changed=false;
        for(int y=0;y<300;++y)for(int x=0;x<400;++x) {
            const int offset=y*50+x/8,mask=0x80>>(x%8);
            if((canvas.data()[offset]&mask)==(background.data()[offset]&mask))continue;
            changed=true;assert(x>=24 && x<right && y>=160 && y<bottom);
        }
        assert(changed);
    }
    // The tiny ellipsis is three distinct pixels, not two dots or three wide cells.
    assert(TextTinyWidth("…")==6);assert(TextTinyWidth("Vacació…")==34);
    tiny.Clear();TextTiny(tiny,10,10,"…");
    int dots=0;
    for(int y=0;y<300;++y)for(int x=0;x<400;++x) {
        if(tiny.data()[y*50+x/8]&(0x80>>(x%8)))continue;
        ++dots;assert(y==16 && (x==10 || x==12 || x==14));
    }
    assert(dots==3);
    // Startup performs no visible write before fresh data, including failed retries
    // and short-click refreshes. A deliberate voice/setup view may replace it.
    BootDisplay boot;boot.Begin(true);
    assert(!boot.CanPaint());
    for(int retry=0;retry<3;++retry){boot.HomeResult(false);assert(!boot.CanPaint());}
    boot.HomeResult(true);assert(boot.CanPaint());
    boot.HomeResult(false);assert(boot.CanPaint()); // Cached frame now exists.
    boot.Begin(true);boot.ShowInteraction();assert(boot.CanPaint());
    boot.HomeResult(false);assert(boot.CanPaint());
    boot.Begin(false);assert(boot.CanPaint()); // First-time setup remains visible.
    DrawHome(background,&day,home->today,false,false,false,true);
    for(bool failed:{false,true}) {
        canvas=background;DrawFirmwareUpdate(canvas,failed);
        bool changed=false;
        for(int y=0;y<300;++y)for(int x=0;x<400;++x) {
            const int offset=y*50+x/8,mask=0x80>>(x%8);
            if((canvas.data()[offset]&mask)==(background.data()[offset]&mask))continue;
            changed=true;assert(x>=352 && x<373 && y>=9 && y<27);
        }
        assert(changed);
        if(argc>1)Save(std::string(argv[1])+(failed ? "/daily-firmware-error.pgm" : "/daily-firmware-updating.pgm"),canvas);
    }
    // Long text and all 6-column layouts stay inside the white modal surface.
    std::memset(card.body,'W',sizeof(card.body)-1);DrawModal(canvas,background,card);
    std::puts("Home parsing, UI flow and daily/modal rendering verified");
}
