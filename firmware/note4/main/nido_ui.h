#pragma once
#include <cstdint>
namespace nido {
enum class UiMode { Day, Capturing, Processing, Question, Result, Error, Uncertain };
enum class UiEvent { Press, Click, SendAudio, Ask, Done, Fail, Unknown, Dismiss, Expire };
struct UiFlow {
    UiMode mode = UiMode::Day;
    bool busy() const { return mode==UiMode::Capturing || mode==UiMode::Processing; }
    bool modal() const { return mode!=UiMode::Day; }
    void Dispatch(UiEvent event) {
        switch(event) {
        case UiEvent::Press: mode=UiMode::Capturing;break;
        case UiEvent::Click: if(mode==UiMode::Capturing)mode=UiMode::Day;break;
        case UiEvent::SendAudio: if(mode==UiMode::Capturing || mode==UiMode::Question)mode=UiMode::Processing;break;
        case UiEvent::Ask: if(mode==UiMode::Processing)mode=UiMode::Question;break;
        case UiEvent::Done: if(mode==UiMode::Processing)mode=UiMode::Result;break;
        case UiEvent::Fail: mode=UiMode::Error;break;
        case UiEvent::Unknown: mode=UiMode::Uncertain;break;
        case UiEvent::Dismiss: if(!busy())mode=UiMode::Day;break;
        case UiEvent::Expire: if(!busy())mode=UiMode::Day;break;
        }
    }
};
constexpr uint32_t kClickMs=200;
constexpr bool IsFrontClick(int64_t held_us, bool released, uint32_t samples) {
    return released && held_us>=0 && held_us<kClickMs*1000LL && samples==0;
}
// Measure captured PCM, excluding codec preparation and the discarded warm-up.
constexpr bool IsAccidentalRecording(uint32_t samples, uint32_t sample_rate) {
    return sample_rate>0 && samples<sample_rate;
}
constexpr int64_t kRefreshUs=300000000;
}
