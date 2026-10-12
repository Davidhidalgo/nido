#include "hearth_canvas.h"

#include <algorithm>
#include <cstdlib>

#include "zectrix_ascii_font_8x16.h"

namespace {
struct Glyph { unsigned char base; unsigned char accent = 0; };

// Decode one complete UTF-8 character. Unsupported characters occupy one
// replacement glyph, rather than one '?' per byte. Spanish accents reuse the
// licensed base font with a small mark; input is expected in NFC form.
Glyph NextGlyph(const unsigned char*& cursor) {
    uint32_t code = *cursor++;
    if (code >= 0x80) {
        int remaining = code >= 0xc2 && code <= 0xdf ? 1 :
            code >= 0xe0 && code <= 0xef ? 2 :
            code >= 0xf0 && code <= 0xf4 ? 3 : 0;
        if (!remaining) return {'?'};
        const int count = remaining;
        code &= (1U << (6 - remaining)) - 1;
        while (remaining--) {
            if ((*cursor & 0xc0) != 0x80) return {'?'};
            code = (code << 6) | (*cursor++ & 0x3f);
        }
        if ((count == 1 && code < 0x80) || (count == 2 && code < 0x800) ||
            (count == 3 && code < 0x10000) || code > 0x10ffff ||
            (code >= 0xd800 && code <= 0xdfff)) return {'?'};
    }
    if (code >= 0x20 && code <= 0x7e) return {static_cast<unsigned char>(code)};
    switch (code) {
        case 0xe1: return {'a', 1}; case 0xc1: return {'A', 1};
        case 0xe9: return {'e', 1}; case 0xc9: return {'E', 1};
        case 0xed: return {'i', 1}; case 0xcd: return {'I', 1};
        case 0xf3: return {'o', 1}; case 0xd3: return {'O', 1};
        case 0xfa: return {'u', 1}; case 0xda: return {'U', 1};
        case 0xf1: return {'n', 2}; case 0xd1: return {'N', 2};
        case 0xfc: return {'u', 3}; case 0xdc: return {'U', 3};
        case 0xa1: return {'!', 4}; case 0xbf: return {'?', 4};
        case 0xb7: return {'.', 5};
        case 0x2026: return {'W', 6}; // three dots in one glyph cell
        case 0x2013: case 0x2014: return {'-'};
        case 0x2018: case 0x2019: return {'\''};
        case 0x201c: case 0x201d: return {'"'};
        default: return {'?'};
    }
}
}

void HearthCanvas::Clear(bool white) {
    pixels_.fill(white ? 0xff : 0x00);
}

void HearthCanvas::Pixel(int x, int y, bool black) {
    if (x < 0 || x >= kWidth || y < 0 || y >= kHeight) {
        return;
    }
    uint8_t& byte = pixels_[static_cast<size_t>(y) * kStride + x / 8];
    const uint8_t mask = static_cast<uint8_t>(1U << (7 - (x & 7)));
    if (black) {
        byte &= static_cast<uint8_t>(~mask);
    } else {
        byte |= mask;
    }
}

void HearthCanvas::FillRect(int x, int y, int width, int height, bool black) {
    const int left = std::max(0, x);
    const int top = std::max(0, y);
    const int right = std::min(kWidth, x + width);
    const int bottom = std::min(kHeight, y + height);
    for (int py = top; py < bottom; ++py) {
        for (int px = left; px < right; ++px) {
            Pixel(px, py, black);
        }
    }
}

void HearthCanvas::Rect(int x, int y, int width, int height, bool black) {
    Line(x, y, x + width - 1, y, black);
    Line(x, y + height - 1, x + width - 1, y + height - 1, black);
    Line(x, y, x, y + height - 1, black);
    Line(x + width - 1, y, x + width - 1, y + height - 1, black);
}

void HearthCanvas::HLine(int x, int y, int width, bool black) {
    Line(x, y, x + width - 1, y, black);
}

void HearthCanvas::Line(int x0, int y0, int x1, int y1, bool black) {
    const int dx = std::abs(x1 - x0);
    const int sx = x0 < x1 ? 1 : -1;
    const int dy = -std::abs(y1 - y0);
    const int sy = y0 < y1 ? 1 : -1;
    int error = dx + dy;
    while (true) {
        Pixel(x0, y0, black);
        if (x0 == x1 && y0 == y1) {
            break;
        }
        const int twice = error * 2;
        if (twice >= dy) {
            error += dy;
            x0 += sx;
        }
        if (twice <= dx) {
            error += dx;
            y0 += sy;
        }
    }
}

void HearthCanvas::Text(int x, int y, const char* text, int scale,
                        bool inverted) {
    if (text == nullptr || scale <= 0) {
        return;
    }
    int cursor_x = x;
    const unsigned char* cursor = reinterpret_cast<const unsigned char*>(text);
    while (*cursor) {
        const Glyph decoded = NextGlyph(cursor);
        const unsigned char code = decoded.base;
        const size_t glyph_index = code - 0x20;
        const uint16_t* glyph = kZectrixAsciiFont8x16[glyph_index];
        const int glyph_width = kZectrixAsciiFontWidths[glyph_index];
        if (decoded.accent == 6) {
            if (inverted) FillRect(cursor_x,y,glyph_width*scale,16*scale,true);
            for (int dot=0;dot<3;++dot)
                FillRect(cursor_x+dot*3*scale,y+12*scale,scale,scale,!inverted);
            cursor_x += glyph_width*scale;
            continue;
        }
        if (inverted) {
            FillRect(cursor_x, y, glyph_width * scale, 16 * scale, true);
        }
        for (int row = 0; row < 16; ++row) {
            for (int column = 0; column < glyph_width; ++column) {
                const int glyph_row = decoded.accent == 4 ? 15 - row : row;
                const bool set = (glyph[glyph_row] & (1U << (15 - column))) != 0;
                if (!set && !inverted) {
                    continue;
                }
                FillRect(cursor_x + column * scale, y + row * scale, scale,
                         scale, inverted ? !set : true);
            }
        }
        const auto mark = [&](int col, int row) {
            FillRect(cursor_x + col * scale, y + row * scale, scale, scale, !inverted);
        };
        const int middle = glyph_width / 2;
        if (decoded.accent == 1) { mark(middle, 2); mark(middle + 1, 1); }
        if (decoded.accent == 2) {
            mark(1, 2); mark(2, 1); mark(3, 2); mark(4, 1);
        }
        if (decoded.accent == 3) { mark(1, 1); mark(glyph_width - 2, 1); }
        if (decoded.accent == 5) {
            FillRect(cursor_x, y, glyph_width * scale, 16 * scale, inverted);
            mark(middle, 8);
        }
        cursor_x += glyph_width * scale;
    }
}

void HearthCanvas::TextCentered(int y, const char* text, int scale,
                                bool inverted) {
    Text((kWidth - TextWidth(text, scale)) / 2, y, text, scale, inverted);
}

void HearthCanvas::Icon16(int x, int y, const uint16_t rows[16],
                           bool inverted) {
    if (rows == nullptr) {
        return;
    }
    for (int row = 0; row < 16; ++row) {
        for (int col = 0; col < 16; ++col) {
            const bool set = (rows[row] & static_cast<uint16_t>(0x8000u >> col)) != 0;
            if (inverted) {
                Pixel(x + col, y + row, !set);
            } else if (set) {
                Pixel(x + col, y + row, true);
            }
        }
    }
}

int HearthCanvas::TextWidth(const char* text, int scale) const {
    if (text == nullptr || scale <= 0) {
        return 0;
    }
    int width = 0;
    const unsigned char* cursor = reinterpret_cast<const unsigned char*>(text);
    while (*cursor) {
        width += kZectrixAsciiFontWidths[NextGlyph(cursor).base - 0x20] * scale;
    }
    return width;
}
