#include "nido_screens.h"
#include "qrcodegen.h"
#include "nido_small_font.h"
#include "nido_date.h"
#include <ctime>
#include <cstdio>
#include <algorithm>
#include <cstring>
#include <string>
#include <vector>

namespace nido {
namespace {
constexpr int kLeft = 28;
constexpr int kContentWidth = 344;
constexpr int kStateLeft = 236;
constexpr int kStateWidth = 148;

// Neutral tones are sparse ordered ink patterns, compatible with 1-bit updates.
bool Ink(int x, int y, int density) {
    if(density==4)return (x+y)%2==0;
    return density == 1 ? (x % 8 == 0 && y % 8 == 0) :
        density == 3 ? (x % 4 == 0 && y % 8 == 0) :
                       (y % 2 == 0 && (x + (y % 4)) % 4 == 0);
}
void Tone(HearthCanvas& canvas, int x, int y, int w, int h, int density = 1) {
    for (int py=y; py<y+h; ++py)
        for (int px=x; px<x+w; ++px)
            if (Ink(px,py,density)) canvas.Pixel(px,py,true);
}
bool Inside(int x, int y, int w, int h, int r) {
    if (x<0 || y<0 || x>=w || y>=h) return false;
    const int dx = x<r ? r-x : x>=w-r ? x-(w-r-1) : 0;
    const int dy = y<r ? r-y : y>=h-r ? y-(h-r-1) : 0;
    return dx*dx + dy*dy <= r*r;
}
void Rounded(HearthCanvas& canvas, int x, int y, int w, int h,
             int radius, bool border, int density = 0) {
    for (int py=0; py<h; ++py) {
        for (int px=0; px<w; ++px) {
            if (!Inside(px,py,w,h,radius)) continue;
            const bool edge = border && (!Inside(px-1,py,w,h,radius) ||
                !Inside(px+1,py,w,h,radius) || !Inside(px,py-1,w,h,radius) ||
                !Inside(px,py+1,w,h,radius));
            canvas.Pixel(x+px,y+py,edge || (density && Ink(x+px,y+py,density)));
        }
    }
}
// A small open nest: an egg and three curved layers, drawn at native resolution.
void Nest(HearthCanvas& canvas, int x, int y, int scale = 1) {
    const auto stroke = [&](int x0,int y0,int x1,int y1) {
        canvas.Line(x+x0*scale,y+y0*scale,x+x1*scale,y+y1*scale);
        if (scale>1) canvas.Line(x+x0*scale,y+y0*scale+1,x+x1*scale,y+y1*scale+1);
    };
    stroke(11,0,8,3); stroke(8,3,8,8); stroke(8,8,11,10);
    stroke(11,10,14,8); stroke(14,8,14,3); stroke(14,3,11,0);
    stroke(0,9,4,14); stroke(4,14,11,16); stroke(11,16,18,14); stroke(18,14,22,9);
    stroke(2,15,6,19); stroke(6,19,11,20); stroke(11,20,16,19); stroke(16,19,20,15);
    stroke(5,21,11,23); stroke(11,23,17,21);
}
void Frame(HearthCanvas& canvas) {
    canvas.Clear();
    Tone(canvas,0,0,400,300);
    // Header is separate from the content card, with generous optical margins.
    canvas.FillRect(16,10,368,36,false);
    Nest(canvas,24,16);
    canvas.Text(60,12,"NIDO",2);
    Rounded(canvas,19,61,368,228,9,false,2);
    Rounded(canvas,16,56,368,228,9,true);
}
int Wrap(HearthCanvas&, int, const char*, int, int, int, int, bool small=false);
void Stamp(HearthCanvas& canvas, const char* label, const char* status) {
    Rounded(canvas,kStateLeft,16,kStateWidth,24,5,true);
    const int text_width=canvas.TextWidth(label);
    const int x=kStateLeft+(kStateWidth-text_width-16)/2, y=24;
    if (std::strcmp(status,"done")==0) {
        canvas.Line(x,y+4,x+3,y+7); canvas.Line(x+3,y+7,x+9,y);
    } else if (std::strcmp(status,"question")==0) {
        canvas.Text(x,y-4,"?");
    } else if (std::strcmp(status,"progress")==0) {
        for (int i=0;i<3;++i) canvas.FillRect(x+i*4,y+3,2,2,true);
    } else {
        canvas.Rect(x,y,9,9); canvas.HLine(x+2,y+4,5);
    }
    Wrap(canvas,20,label,1,1,x+16,kStateLeft+kStateWidth-x-22);
}
size_t PreviousGlyph(const std::string& text, size_t end) {
    if (!end) return 0;
    --end;
    while (end && (static_cast<unsigned char>(text[end]) & 0xc0)==0x80) --end;
    return end;
}
// Wrap within a real content box. Truncation always keeps a complete UTF-8 glyph.
int Wrap(HearthCanvas& canvas, int y, const char* text, int scale, int rows,
         int x=kLeft, int width=kContentWidth, bool small) {
    if (!text || !*text || rows<=0) return 0;
    const int step = small ? 12 : scale*16 + (scale==2 ? 0 : 2);
    const auto textWidth=[&](const std::string& value){return small ? TextSmallWidth(value.c_str()) : canvas.TextWidth(value.c_str(),scale);};
    std::vector<std::string> lines;
    std::string line;
    const std::string content(text);
    size_t at=0;
    bool truncated=false;
    while (at<content.size()) {
        const size_t start=at;
        const unsigned char lead=content[at];
        const size_t bytes=lead<0x80 ? 1 : (lead & 0xe0)==0xc0 ? 2 :
            (lead & 0xf0)==0xe0 ? 3 : (lead & 0xf8)==0xf0 ? 4 : 1;
        const std::string unit=content.substr(at,std::min(bytes,content.size()-at));
        at+=unit.size();
        if (unit=="\n") {
            lines.push_back(line); line.clear();
        } else {
            if (line.empty() && unit==" ") continue;
            if (textWidth(line+unit)>width) {
                const size_t space=line.find_last_of(' ');
                if (space!=std::string::npos && space>0) {
                    lines.push_back(line.substr(0,space)); line=line.substr(space+1);
                } else { lines.push_back(line); line.clear(); }
                // Retry the current glyph after moving a word to the next line.
                at=start;
            } else { line+=unit; continue; }
        }
        if (static_cast<int>(lines.size())>=rows) { truncated=at<content.size(); break; }
    }
    if (!line.empty() && static_cast<int>(lines.size())<rows) lines.push_back(line);
    if (truncated && !lines.empty()) {
        auto& last=lines.back();
        while (!last.empty() && textWidth(last+"…")>width)
            last.resize(PreviousGlyph(last,last.size()));
        while (!last.empty() && last.back()==' ') last.pop_back();
        last+="…";
    }
    for (size_t row=0;row<lines.size();++row) {
        if(small)TextSmall(canvas,x,y+row*step,lines[row].c_str());
        else canvas.Text(x,y+row*step,lines[row].c_str(),scale);
    }
    return static_cast<int>(lines.size())*step;
}
void Date(const char* iso, char* output, size_t size) {
    std::snprintf(output,size,"%.2s/%.2s/%.4s",iso+8,iso+5,iso);
}
void Choice(HearthCanvas& canvas, int y, int number, const char* label) {
    Rounded(canvas,kLeft,y,kContentWidth,38,5,true);
    DrawButtonSymbol(canvas,kLeft+13,y+8,number==1 ? ButtonSymbol::Upper : ButtonSymbol::Lower);
    const int top=canvas.TextWidth(label)<=kContentWidth-44 ? 11 : 2;
    Wrap(canvas,y+top,label,1,2,kLeft+34,kContentWidth-44);
}
int CompactTitle(HearthCanvas& canvas, const char* title, int rows=1) {
    const int height=Wrap(canvas,68,title,2,rows);
    return 68+height+(height>32 ? 4 : 12);
}
void Panel(HearthCanvas& canvas, int y, int height, const char* label, const char* value, bool emphasis) {
    Rounded(canvas,kLeft,y,kContentWidth,height,5,true,emphasis ? 3 : 0);
    if (emphasis) canvas.FillRect(kLeft+8,y+3,kContentWidth-16,height-6,false);
    Wrap(canvas,y+4,label,1,1,kLeft+10,kContentWidth-20);
    Wrap(canvas,y+24,value,1,(height-24+2)/18,kLeft+10,kContentWidth-20);
}
void Base(HearthCanvas& canvas, const char* status, const char* title) {
    canvas.Clear();
    canvas.Text(18, 14, "NIDO", 2);
    canvas.Text(18, 54, status);
    canvas.HLine(18, 80, 364);
    canvas.Text(18, 98, title, 2);
    canvas.HLine(18, 256, 364);
    canvas.Text(18, 269, "Prueba local · sin conexión al agente");
}
}

void DrawButtonSymbol(HearthCanvas& canvas,int x,int y,ButtonSymbol button) {
    const bool front=button==ButtonSymbol::Front;
    const int w=front ? 20 : 6,h=front ? 20 : 10;
    for(int part=0;part<(front ? 1 : 2);++part) {
        const bool active=front || (part==0 ? button==ButtonSymbol::Upper : button==ButtonSymbol::Lower);
        const int stroke=active ? 2 : 1,top=y+part*12;
        for(int py=0;py<h;++py)for(int px=0;px<w;++px) {
            const int dx=2*px-19,dy=2*py-19;
            const bool outer=front ? dx*dx+dy*dy<=19*19 : Inside(px,py,w,h,1);
            if(!outer)continue;
            const bool inner=front ? dx*dx+dy*dy<=15*15 : Inside(px-stroke,py-stroke,w-2*stroke,h-2*stroke,0);
            canvas.Pixel(x+px,top+py,!inner || (active && px%2==0 && py%2==0));
        }
    }
}

void DrawReady(HearthCanvas& canvas, bool connected) {
    if (connected) {
        DrawHome(canvas,nullptr,"");
        return;
    }
    Base(canvas, "NOTE4 · PRUEBA DE HARDWARE", "Listo para probar");
    canvas.Text(18, 150, "Mantén el botón frontal.");
    canvas.Text(18, 178, "Habla cuando se encienda el LED.");
    canvas.Text(18, 206, "Suelta para terminar la grabación.");
}

void DrawHome(HearthCanvas& canvas,const HomeDay* day,const char* today,bool updating,bool failed,bool demo,bool low_battery, const HomeSnapshot* snapshot) {
    canvas.Clear();Tone(canvas,0,34,400,266);
    char header[128]="hoy · sin datos";
    if(day) {
        const char* relative="";
        if(std::strcmp(day->date,today)==0)relative="hoy · ";
        else {
            tm d{},t{};int dy,dm,dd,ty,tmn,td;
            if(std::sscanf(day->date,"%d-%d-%d",&dy,&dm,&dd)==3 && std::sscanf(today,"%d-%d-%d",&ty,&tmn,&td)==3) {
                d.tm_year=dy-1900;d.tm_mon=dm-1;d.tm_mday=dd;d.tm_hour=12;
                t.tm_year=ty-1900;t.tm_mon=tmn-1;t.tm_mday=td;t.tm_hour=12;
                const int gap=static_cast<int>((UtcSeconds(d)-UtcSeconds(t))/86400);
                relative=gap==1 ? "mañana · " : gap==-1 ? "ayer · " : "";
            }
        }
        std::snprintf(header,sizeof(header),"%s%s%s",demo ? "demo · " : "",relative,day->label);
    }
    Wrap(canvas,10,header,1,1,16,328);
    if(updating) {
        canvas.Line(357,12,364,12);canvas.Line(364,12,367,15);canvas.Line(367,15,367,18);
        canvas.Line(367,18,369,16);canvas.Line(367,18,364,17);
        canvas.Line(367,23,360,23);canvas.Line(360,23,357,20);canvas.Line(357,20,357,17);
        canvas.Line(357,17,355,19);canvas.Line(357,17,360,18);
    } else if(failed) {
        canvas.Line(362,11,368,23);canvas.Line(368,23,356,23);canvas.Line(356,23,362,11);
        canvas.Line(362,15,362,18);canvas.Pixel(362,21,true);
    }
    if(low_battery) {canvas.Rect(379,14,12,7);canvas.FillRect(391,16,2,3,true);canvas.FillRect(381,16,2,3,true);}
    const auto box=[&](int x,int y,int w,int h) {
        Rounded(canvas,x+3,y+4,w,h,5,false,4);Rounded(canvas,x,y,w,h,5,true);
    };
    for(int i=0;i<2;++i) {
        const int x=i ? 204 : 16;box(x,42,180,70);TextSmall(canvas,x+9,49,i ? "cena" : "comida");
        const char* meal=day && day->available ? (i ? day->dinner : day->lunch) : "";
        Wrap(canvas,68,*meal ? meal : day && day->available ? "Sin planificar" : "Sin datos",1,2,x+9,162);
    }
    canvas.FillRect(16,118,368,18,false);TextSmall(canvas,16,122,"agenda");
    if(!day || !day->available){canvas.Text(25,165,"Sin datos disponibles");return;}
    if(day->more){char count[16];std::snprintf(count,sizeof(count),"+%d",day->more);TextSmall(canvas,384-TextSmallWidth(count),122,count);}
    struct Entry { const HomeEvent* event; const HomeDay* source; };
    Entry entries[6]{};
    int count=std::clamp(day->event_count,0,6);
    for(int i=0;i<count;++i)entries[i]={&day->events[i],day};
    // Fill from the downloaded cache only; preserve the selected day's meals/header.
    if(snapshot && count<6 && day->more==0) {
        for(int d=0;d<snapshot->day_count && count<6;++d) {
            const auto& next=snapshot->days[d];
            if(!next.available || std::strcmp(next.date,day->date)<=0)continue;
            for(int i=0;i<next.event_count && count<6;++i) {
                const auto& candidate=next.events[i];bool duplicate=false;
                if(*candidate.key)for(int j=0;j<count;++j)
                    if(std::strcmp(candidate.key,entries[j].event->key)==0)duplicate=true;
                if(!duplicate)entries[count++]={&candidate,&next};
            }
        }
    }
    if(!count){canvas.Text(25,165,"Sin eventos pendientes");return;}
    const int cols=count<=3 ? count : count==4 ? 2 : 3;
    const int rows=count<=3 ? 1 : 2,w=(368-(cols-1)*8)/cols,h=rows==2 ? 70 : 150;
    for(int i=0;i<count;++i) {
        const auto& event=*entries[i].event;const int x=16+(i%cols)*(w+8),y=140+(i/cols)*(h+10);
        box(x,y,w,h);
        const bool future_day=entries[i].source!=day;
        if(future_day) {
            // Attenuate the border/shadow before drawing crisp text.
            for(int py=y;py<y+h+4;++py)for(int px=x;px<x+w+3;++px)
                if(px%2==0 && py%2==0)canvas.Pixel(px,py,false);
        }
        const bool multiple_days=*event.start_date && *event.end_date &&
            std::strcmp(event.start_date,event.end_date)!=0;
        if(multiple_days) {
            char range[32];std::snprintf(range,sizeof(range),"%.2s/%.2s - %.2s/%.2s",
                event.start_date+8,event.start_date+5,event.end_date+8,event.end_date+5);
            TextSmall(canvas,x+8,y+7,range);
        } else if(future_day && (i==0 || entries[i-1].source!=entries[i].source)) {
            int sy,sm,sd;const char* label=entries[i].source->label;
            char compact[32];
            if(std::sscanf(entries[i].source->date,"%d-%d-%d",&sy,&sm,&sd)==3) {
                const char* weekdays[]={"domingo","lunes","martes","miércoles","jueves","viernes","sábado"};
                const int weekday=static_cast<int>((CivilDays(sy,sm,sd)+4)%7);
                label=weekdays[(weekday+7)%7];
                // Beyond the coming week, retain the date to disambiguate weekdays.
                int dy,dm,dd;
                if(std::sscanf(day->date,"%d-%d-%d",&dy,&dm,&dd)==3 &&
                   CivilDays(sy,sm,sd)-CivilDays(dy,dm,dd)>=7) {
                    std::snprintf(compact,sizeof(compact),"%s %02d/%02d",label,sd,sm);label=compact;
                }
            }
            TextSmall(canvas,x+8,y+7,label);
        }
        const bool named=*event.calendar_label;
        const bool stacked=named && !event.all_day &&
            TextTinyWidth(event.calendar_label)+3+TextSmallWidth(event.time)>w-16;
        const int label_y=y+h-17-(stacked ? 12 : 0);
        const int title_y=y+(stacked && !future_day && !multiple_days ? 7 : future_day || multiple_days ? 20 : 18);
        const int step=future_day ? 12 : 18, glyph_height=future_day ? 10 : 16;
        const int footer_y=named ? label_y : !event.all_day ? y+h-17 : y+h-4;
        const int previous_rows=future_day ? (h-20-(event.all_day ? 4 : 21))/12 : rows==2 ? 2 : event.all_day ? 6 : 5;
        const int title_rows=std::min(previous_rows,std::max(1,(footer_y-title_y-glyph_height+step)/step));
        Wrap(canvas,title_y,event.summary,1,title_rows,x+8,w-16,future_day);
        if(named) {
            const int label_width=stacked || event.all_day ? w-16 : w-19-TextSmallWidth(event.time);
            std::string label=event.calendar_label;
            if(TextTinyWidth(label.c_str())>label_width) {
                while(!label.empty() && TextTinyWidth((label+"…").c_str())>label_width)
                    label.resize(PreviousGlyph(label,label.size()));
                label+="…";
            }
            TextTiny(canvas,x+8,label_y+2,label.c_str());
        }
        if(!event.all_day)TextSmall(canvas,x+w-8-TextSmallWidth(event.time),y+h-17,event.time);

    }
}
bool DrawMaintenance(HearthCanvas& canvas,const HearthCanvas& background,const char* ssid,const char* version) {
    // The temporary open AP uses a stable 11-character hardware-derived SSID.
    if(!ssid || std::strlen(ssid)>11)return false;
    auto escape=[](const char* value){std::string out;for(;*value;++value){if(std::strchr("\\;,:\"",*value))out+='\\';out+=*value;}return out;};
    const std::string payload="WIFI:T:nopass;S:"+escape(ssid)+";;";
    uint8_t scratch[qrcodegen_BUFFER_LEN_FOR_VERSION(4)],qr[qrcodegen_BUFFER_LEN_FOR_VERSION(4)];
    if(!qrcodegen_encodeText(payload.c_str(),scratch,qr,qrcodegen_Ecc_MEDIUM,1,4,qrcodegen_Mask_AUTO,true))return false;
    canvas=background;
    for(int y=0;y<300;++y)for(int x=0;x<400;++x)if((x+y)%4==0 && y%2==0)canvas.Pixel(x,y,true);
    Rounded(canvas,27,45,352,218,7,false,4);Rounded(canvas,24,41,352,218,7,true);
    TextSmall(canvas,34,51,"configuración");canvas.Text(34,68,"Escanea para conectar");
    const int modules=qrcodegen_getSize(qr),side=(modules+8)*3;
    const int left=34+(123-side)/2,top=92+(123-side)/2;
    canvas.FillRect(left,top,side,side,false);
    for(int y=0;y<modules;++y)for(int x=0;x<modules;++x)
        if(qrcodegen_getModule(qr,x,y))canvas.FillRect(left+(x+4)*3,top+(y+4)*3,3,3,true);
    TextSmall(canvas,174,104,"red wifi");canvas.Text(174,118,ssid);
    TextSmall(canvas,174,147,"red temporal");canvas.Text(174,161,"Sin contraseña");
    TextSmall(canvas,174,190,"si no abre la web:");TextSmall(canvas,174,204,"192.168.4.1");
    TextSmall(canvas,34,237,"frontal + inferior: salir");
    if(version && std::strlen(version)<=31)TextTiny(canvas,366-TextTinyWidth(version),249,version);
    return true;
}
void DrawModal(HearthCanvas& canvas,const HearthCanvas& background,const DeviceCard& card) {
    canvas=background;
    // Monochrome veil leaves the day recognizable; the modal is an opaque surface.
    for(int y=0;y<300;++y)for(int x=0;x<400;++x)if((x+y)%4==0 && y%2==0)canvas.Pixel(x,y,true);
    constexpr int top=(300-194)/2, bottom=top+194-6;
    Rounded(canvas,27,top+4,352,194,7,false,4);Rounded(canvas,24,top,352,194,7,true);
    const char* state=std::strcmp(card.status,"progress")==0 ? "en curso" :
        std::strcmp(card.status,"question")==0 ? "pregunta" : std::strcmp(card.status,"error")==0 ? "revisar" :
        std::strcmp(card.status,"partial")==0 ? "parcial" : "listo";
    TextSmall(canvas,34,top+8,state);
    const int y=top+22+Wrap(canvas,top+22,card.title,1,2,34,332)+4;
    if(std::strcmp(card.type,"binary")==0) {
        Wrap(canvas,y,card.body,1,std::max(1,(top+122-y)/18),34,332);
        for(int i=0;i<2;++i) {
            const int option_top=top+124+i*32;Rounded(canvas,34,option_top,332,28,4,true);
            DrawButtonSymbol(canvas,42,option_top+3,i==0 ? ButtonSymbol::Upper : ButtonSymbol::Lower);
            Wrap(canvas,option_top+6,card.labels[i],1,1,56,300);
        }
    } else if(std::strcmp(card.type,"event")==0) {
        const int next=y+Wrap(canvas,y,card.summary,1,2,34,332)+4;
        char date[11],end_date[11],line[80];Date(card.date,date,sizeof(date));Date(card.end_date,end_date,sizeof(end_date));
        std::snprintf(line,sizeof(line),"%s%s%s",date,std::strcmp(card.date,card.end_date)==0 ? "" : " - ",std::strcmp(card.date,card.end_date)==0 ? "" : end_date);
        canvas.Text(34,next,line);
        std::snprintf(line,sizeof(line),"%s - %s",card.start_time,card.end_time);
        if(card.all_day)TextSmall(canvas,34,next+22,"todo el día");else canvas.Text(34,next+20,line);
        if(card.duration_estimated)TextSmall(canvas,240,next+24,"estimada");
        Wrap(canvas,next+42,card.location,1,std::max(0,(bottom-next-42)/18),34,332);
    } else if(std::strcmp(card.type,"list")==0 || std::strcmp(card.type,"facts")==0) {
        for(int i=0;i<card.row_count;++i){int top=y+i*40;Wrap(canvas,top,card.rows[i].label,1,1,34,332);Wrap(canvas,top+18,card.rows[i].value,1,1,34,332);}
    } else if(std::strcmp(card.type,"meal_change")==0 || std::strcmp(card.type,"compare")==0) {
        TextSmall(canvas,34,y,std::strcmp(card.type,"meal_change")==0 ? "antes" : card.before_label);
        Wrap(canvas,y+16,card.before,1,2,34,332);
        TextSmall(canvas,34,y+54,std::strcmp(card.type,"meal_change")==0 ? "ahora" : card.after_label);
        Wrap(canvas,y+70,card.after,1,2,34,332);
    } else if(std::strcmp(card.type,"highlight")==0) {
        const int height=Wrap(canvas,y,card.value,2,2,34,332);
        Wrap(canvas,y+height+4,card.caption,1,2,34,332);
        Wrap(canvas,y+height+42,card.body,1,std::max(0,(bottom-y-height-42)/18),34,332);
    } else Wrap(canvas,y,card.body,1,std::max(1,(bottom-y)/18),34,332);
}

void DrawListening(HearthCanvas& canvas, bool connected) {
    if (connected) {
        DeviceCard card = {};
        std::strcpy(card.status,"progress"); std::strcpy(card.type,"text");
        std::strcpy(card.title,"Te escucho…"); std::strcpy(card.body,"");
        DrawDeviceCard(canvas,card);
        return;
    }
    Base(canvas, "MICRÓFONO ACTIVO", "Escuchando...");
    canvas.Text(18, 156, "Suelta el botón cuando termines.");
    canvas.Text(18, 190, "El audio permanece en este dispositivo.");
}

void DrawRecorded(HearthCanvas& canvas, const AudioSummary& summary,
                  bool limited, bool failed) {
    const char* title = failed ? "Error de audio" :
        summary.has_signal ? "Audio capturado" : "Sin señal de audio";
    Base(canvas, failed || !summary.has_signal ? "REVISAR MICRÓFONO" :
        "PRUEBA COMPLETADA", title);
    char line[80];
    std::snprintf(line, sizeof(line), "Grabación: %lu.%lu s · pico: %lu",
        static_cast<unsigned long>(summary.duration_ms / 1000),
        static_cast<unsigned long>(summary.duration_ms % 1000 / 100),
        static_cast<unsigned long>(summary.peak));
    canvas.Text(18, 154, line);
    canvas.Text(18, 186, limited ? "Alcanzado el límite de grabación." :
        failed ? "No se ha podido leer todo el audio." :
        "El audio se descarta al terminar.");
    canvas.Text(18, 218, "Voy a dormir. Mantén el frontal para repetir.");
}
void DrawDeviceCard(HearthCanvas& canvas, const DeviceCard& card) {
    const char* state = std::strcmp(card.status,"progress")==0 ? "EN CURSO" :
        std::strcmp(card.status,"question")==0 ? "UNA PREGUNTA" :
        std::strcmp(card.status,"partial")==0 ? "PARCIAL" :
        std::strcmp(card.status,"error")==0 ? "REVISAR" : "LISTO";
    Frame(canvas);
    if (std::strcmp(card.type,"event")==0) {
        Stamp(canvas,state,card.status);
        Wrap(canvas,68,card.title,1,1);
        const int height=Wrap(canvas,100,card.summary,2,2);
        const int date_y=100+height+6;
        char date[11], end_date[11], line[64];
        Date(card.date,date,sizeof(date)); Date(card.end_date,end_date,sizeof(end_date));
        std::snprintf(line,sizeof(line),"%s%s%s",date,std::strcmp(card.date,card.end_date)==0 ? "" : " - ",
            std::strcmp(card.date,card.end_date)==0 ? "" : end_date);
        canvas.Text(kLeft,date_y,line);
        Rounded(canvas,kLeft,date_y+22,kContentWidth,36,5,true,3);
        Rounded(canvas,kLeft+6,date_y+24,kContentWidth-12,32,3,false);
        std::snprintf(line,sizeof(line),"%s - %s",card.start_time,card.end_time);
        canvas.Text(kLeft+10,date_y+24,card.all_day ? "Todo el día" : line,2);
        if (card.duration_estimated) canvas.Text(288,date_y+34,"estimada");
        Wrap(canvas,date_y+68,card.location,1,2);
        return;
    }
    Stamp(canvas,state,card.status);
    if (std::strcmp(card.type,"list")==0 || std::strcmp(card.type,"facts")==0) {
        const int start=CompactTitle(canvas,card.title,2);
        const bool facts=std::strcmp(card.type,"facts")==0;
        const int count=std::clamp(card.row_count,0,3);
        const int height=count ? (280-start-(count-1)*4)/count : 0;
        for (int i=0;i<count;++i) {
            const int y=start+i*(height+4);
            if (i) Tone(canvas,kLeft,y-2,kContentWidth,1,2);
            if (facts) {
                Wrap(canvas,y,card.rows[i].label,1,2,kLeft,94);
                Wrap(canvas,y,card.rows[i].value,1,std::max(2,(height-4)/18),kLeft+108,kContentWidth-108);
            } else {
                canvas.FillRect(kLeft+2,y+5,4,4,true);
                Wrap(canvas,y,card.rows[i].label,1,1,kLeft+18,kContentWidth-18);
                Wrap(canvas,y+18,card.rows[i].value,1,std::max(1,(height-20)/18),kLeft+18,kContentWidth-18);
            }
        }
    } else if (std::strcmp(card.type,"highlight")==0) {
        CompactTitle(canvas,card.title);
        const int scale=canvas.TextWidth(card.value,3)<=kContentWidth-20 ? 3 : 2;
        Rounded(canvas,kLeft,110,kContentWidth,76,5,true,3);
        Rounded(canvas,kLeft+6,116,kContentWidth-12,64,3,false);
        const int rows=canvas.TextWidth(card.value,scale)<=kContentWidth-20 ? 1 : 2;
        const int y=110+(76-rows*scale*16)/2;
        Wrap(canvas,y,card.value,scale,rows,kLeft+10,kContentWidth-20);
        Wrap(canvas,190,card.caption,1,1);
        Wrap(canvas,212,card.body,1,3);
    } else if (std::strcmp(card.type,"meal_change")==0 || std::strcmp(card.type,"compare")==0) {
        CompactTitle(canvas,card.title);
        const bool meal=std::strcmp(card.type,"meal_change")==0;
        if (meal) {
            char date[11], label[64]; Date(card.date,date,sizeof(date));
            std::snprintf(label,sizeof(label),"%s · %s",date,card.meal);
            canvas.Text(kLeft,104,label);
        }
        Panel(canvas,meal ? 124 : 112,meal ? 76 : 78,meal ? "Antes" : card.before_label,card.before,false);
        Panel(canvas,meal ? 204 : 202,meal ? 76 : 78,meal ? "Ahora" : card.after_label,card.after,true);
    } else if (std::strcmp(card.type,"binary")==0) {
        const int height=Wrap(canvas,68,card.title,2,2);
        const int body_y=68+height+2;
        Wrap(canvas,body_y,card.body,1,(200-body_y+2)/18);
        Choice(canvas,202,1,card.labels[0]); Choice(canvas,242,2,card.labels[1]);
    } else {
        const int height=Wrap(canvas,68,card.title,2,2);
        const int body_y=68+height+10;
        Wrap(canvas,body_y,card.body,1,(276-body_y)/18);
    }
}
void DrawStatusIcons(HearthCanvas& canvas, bool low_battery, bool wifi_connected) {
    // Reserve a fixed gap before the right-aligned request status.
    canvas.FillRect(172,16,58,26,false);
    int right=kStateLeft-6;
    if (low_battery) {
        const int x=right-27;
        canvas.Rect(x,22,24,12); canvas.FillRect(x+24,25,3,6,true);
        canvas.FillRect(x+3,25,4,6,true);
        right=x-6;
    }
    if (!wifi_connected) {
        const int center=right-12;
        for (int x=-11;x<=11;++x) {
            const int y=(x*x)/24;
            canvas.Pixel(center+x,21+y,true); canvas.Pixel(center+x,22+y,true);
        }
        for (int x=-7;x<=7;++x) canvas.Pixel(center+x,28+(x*x)/15,true);
        canvas.FillRect(center-1,34,3,3,true); canvas.Line(center-12,18,center+12,39);
    }
}
void DrawDeviceError(HearthCanvas& canvas, bool uncertain) {
    DeviceCard card = {};
    std::strcpy(card.status,"error"); std::strcpy(card.type,"text");
    std::strcpy(card.title,uncertain ? "Revisar resultado" : "No puedo conectar");
    std::strcpy(card.body,uncertain ? "No llegó la respuesta completa. Puede haberse aplicado un cambio." : "No he podido conectar con Nido.");
    DrawDeviceCard(canvas,card);
}
}  // namespace nido
