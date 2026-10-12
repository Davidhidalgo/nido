#include "nido_small_font.h"
namespace nido {
void TextSmall(HearthCanvas& c,int x,int y,const char* text) {
    // Dedicated 5x7 glyphs, with an eighth row for descenders, inside 6x10 cells.
    static const unsigned char letters[26][5]={
      {0x20,0x54,0x54,0x54,0x78},{0x7f,0x48,0x44,0x44,0x38},
      {0x38,0x44,0x44,0x44,0x20},{0x38,0x44,0x44,0x48,0x7f},
      {0x38,0x54,0x54,0x54,0x18},{0x08,0x7e,0x09,0x01,0x02},
      {0x18,0xa4,0xa4,0xa4,0x7c},{0x7f,0x08,0x04,0x04,0x78},
      {0x00,0x44,0x7d,0x40,0x00},{0x20,0x40,0x44,0x3d,0x00},
      {0x7f,0x10,0x28,0x44,0x00},{0x00,0x41,0x7f,0x40,0x00},
      {0x7c,0x04,0x18,0x04,0x78},{0x7c,0x08,0x04,0x04,0x78},
      {0x38,0x44,0x44,0x44,0x38},{0x7c,0x14,0x14,0x14,0x08},
      {0x08,0x14,0x14,0x18,0x7c},{0x7c,0x08,0x04,0x04,0x08},
      {0x48,0x54,0x54,0x54,0x20},{0x04,0x3f,0x44,0x40,0x20},
      {0x3c,0x40,0x40,0x20,0x7c},{0x1c,0x20,0x40,0x20,0x1c},
      {0x3c,0x40,0x30,0x40,0x3c},{0x44,0x28,0x10,0x28,0x44},
      {0x0c,0x50,0x50,0x50,0x3c},{0x44,0x64,0x54,0x4c,0x44}};
    static const unsigned char digits[10][5]={
      {0x3e,0x51,0x49,0x45,0x3e},{0x00,0x42,0x7f,0x40,0x00},
      {0x42,0x61,0x51,0x49,0x46},{0x21,0x41,0x45,0x4b,0x31},
      {0x18,0x14,0x12,0x7f,0x10},{0x27,0x45,0x45,0x45,0x39},
      {0x3c,0x4a,0x49,0x49,0x30},{0x01,0x71,0x09,0x05,0x03},
      {0x36,0x49,0x49,0x49,0x36},{0x06,0x49,0x49,0x29,0x1e}};
    static const unsigned char plus[5]={0x08,0x08,0x3e,0x08,0x08};
    static const unsigned char colon[5]={0,0x14,0x14,0,0}, dash[5]={0x08,0x08,0x08,0x08,0x08}, dots[5]={0x40,0,0x40,0,0x40};
    static const unsigned char slash[5]={0x40,0x30,0x08,0x06,0x01};
    const unsigned char* at=reinterpret_cast<const unsigned char*>(text);
    while(*at){unsigned char ch=*at++;if(ch>='A'&&ch<='Z')ch+='a'-'A';bool accent=false,tilde=false;
        if(ch==0xc3 && *at){unsigned char tail=*at++;accent=tail!=0xb1;tilde=tail==0xb1;
            ch=tail==0xa1?'a':tail==0xa9?'e':tail==0xad?'i':tail==0xb3?'o':tail==0xba?'u':tail==0xb1?'n':'?';}
        if(ch==0xe2 && at[0]==0x80 && at[1]) {const unsigned char tail=at[1];at+=2;ch=tail==0x93||tail==0x94 ? '-' : tail==0xa6 ? '.' : '?';}
        const unsigned char* glyph=ch>='a'&&ch<='z'?letters[ch-'a']:ch>='0'&&ch<='9'?digits[ch-'0']:ch=='+'?plus:ch==':'?colon:ch=='-'?dash:ch=='.'?dots:ch=='/'?slash:nullptr;
        if(accent){c.Pixel(x+2,y+1,true);c.Pixel(x+3,y,true);}
        if(tilde){c.Pixel(x+1,y+1,true);c.Pixel(x+2,y,true);c.Pixel(x+3,y+1,true);}
        if(glyph)for(int px=0;px<5;++px)for(int py=0;py<8;++py)if(glyph[px]&(1<<py))c.Pixel(x+px,y+2+py,true);
        x+=6;
    }
}

int TextSmallWidth(const char* text) {int n=0;for(const unsigned char* p=reinterpret_cast<const unsigned char*>(text);*p;++p)if((*p&0xc0)!=0x80)++n;return n*6;}
// Calendar identifiers use 3x5 glyphs in 4x7 cells, including room for accents.
void TextTiny(HearthCanvas& c,int x,int y,const char* text) {
    static const unsigned char letters[26][5]={
      {0,6,1,7,5},{4,4,6,5,6},{0,3,4,4,3},{1,1,3,5,3},
      {0,2,5,6,3},{2,5,4,6,4},{0,3,5,3,6},{4,4,6,5,5},
      {2,0,2,2,2},{1,0,1,5,2},{4,5,6,5,5},{6,2,2,2,3},
      {0,0,7,7,5},{0,0,6,5,5},{0,2,5,5,2},{0,6,5,6,4},
      {0,3,5,3,1},{0,0,3,4,4},{0,3,6,1,6},{2,7,2,2,3},
      {0,0,5,5,3},{0,0,5,5,2},{0,0,5,7,7},{0,0,5,2,5},
      {0,5,5,3,6},{0,7,1,2,7}};
    static const unsigned char digits[10][5]={
      {7,5,5,5,7},{2,6,2,2,7},{6,1,2,4,7},{6,1,2,1,6},{5,5,7,1,1},
      {7,4,6,1,6},{3,4,6,5,2},{7,1,2,2,2},{2,5,2,5,2},{2,5,3,1,6}};
    static const unsigned char unknown[5]={7,1,2,0,2},dash[5]={0,0,7,0,0},dots[5]={0,0,0,0,5};
    const auto* at=reinterpret_cast<const unsigned char*>(text);
    while(*at) {
        unsigned int ch=*at++;bool accent=false,grave=false,tilde=false;
        if(ch>=0xc0) {
            const int extra=ch<0xe0 ? 1 : ch<0xf0 ? 2 : 3;
            ch&=extra==1 ? 0x1f : extra==2 ? 0x0f : 0x07;
            for(int n=0;n<extra;++n) {
                if(!*at || (*at&0xc0)!=0x80){ch='?';break;}
                ch=(ch<<6)|(*at++&0x3f);
            }
        }
        if(ch>='A'&&ch<='Z')ch+='a'-'A';
        switch(ch) {
          case 0xc0:case 0xe0:ch='a';grave=true;break;
          case 0xc8:case 0xe8:ch='e';grave=true;break;
          case 0xcc:case 0xec:ch='i';grave=true;break;
          case 0xd2:case 0xf2:ch='o';grave=true;break;
          case 0xd9:case 0xf9:ch='u';grave=true;break;
          case 0xc1:case 0xe1:ch='a';accent=true;break;
          case 0xc9:case 0xe9:ch='e';accent=true;break;
          case 0xcd:case 0xed:ch='i';accent=true;break;
          case 0xd3:case 0xf3:ch='o';accent=true;break;
          case 0xda:case 0xfa:ch='u';accent=true;break;
          case 0xd1:case 0xf1:ch='n';tilde=true;break;
          case 0x2013:case 0x2014:ch='-';break;
          case 0x2026:ch='.';break;
        }
        const auto* glyph=ch>='a'&&ch<='z' ? letters[ch-'a'] : ch>='0'&&ch<='9' ? digits[ch-'0'] : ch=='-' ? dash : ch=='.' ? dots : ch==' ' ? nullptr : unknown;
        if(accent){c.Pixel(x+2,y,true);c.Pixel(x+1,y+1,true);}
        if(grave){c.Pixel(x,y,true);c.Pixel(x+1,y+1,true);}
        if(tilde){c.Pixel(x,y+1,true);c.Pixel(x+1,y,true);c.Pixel(x+2,y+1,true);}
        if(glyph)for(int py=0;py<5;++py)for(int px=0;px<3;++px)
            if(glyph[py]&(4>>px))c.Pixel(x+px,y+2+py,true);
        x+=4;
    }
}
int TextTinyWidth(const char* text) {return TextSmallWidth(text)/6*4;}

}
