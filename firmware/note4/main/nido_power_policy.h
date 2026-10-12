#ifndef NIDO_POWER_POLICY_H_
#define NIDO_POWER_POLICY_H_

#include <cstddef>
#include <cstdint>
#include <cmath>

namespace nido {
constexpr uint64_t kFront = 1ULL << 0;
constexpr uint64_t kRtc = 1ULL << 5;
constexpr uint64_t kDown = 1ULL << 18;
constexpr uint64_t kUp = 1ULL << 39;
constexpr uint64_t kDeepButtons = kFront | kDown;
constexpr uint64_t kLightButtons = kDeepButtons | kUp;
constexpr uint32_t kIdleMs = 10000;
constexpr uint32_t kResultMs = 1500;
inline bool ShowLowBattery(bool valid, uint8_t percent) { return valid && percent < 20; }
inline int64_t SessionRemainingUs(int64_t expires_seconds, int64_t now_us) {
    return expires_seconds > 0 && expires_seconds * 1000000 > now_us ? expires_seconds * 1000000 - now_us : 0;
}
inline uint64_t EarlierWake(uint64_t current, uint64_t candidate) {
    return !current ? candidate : !candidate || current < candidate ? current : candidate;
}

// Level-triggered wake pins must be released. Otherwise deep sleep becomes
// an immediate reboot loop. GPIO39 is deliberately absent from deep wake.
inline uint64_t DeepWakeMask(uint64_t high_pins, bool rtc_armed) {
    return high_pins & (kDeepButtons | (rtc_armed ? kRtc : 0));
}

inline uint32_t NextRecoverySeconds(uint32_t previous) {
    return previous == 0 ? 2 : previous >= 30 ? 60 : previous * 2;
}

struct AudioSummary {
    uint32_t duration_ms = 0;
    uint32_t peak = 0;
    uint32_t rms = 0;
    bool has_signal = false;
};

inline AudioSummary SummarizePcm(const int16_t* pcm, size_t samples,
                                 uint32_t sample_rate) {
    AudioSummary result;
    if (!pcm || samples == 0 || sample_rate == 0) return result;
    result.duration_ms = static_cast<uint32_t>(samples * 1000ULL / sample_rate);
    uint64_t squares = 0;
    for (size_t i = 0; i < samples; ++i) {
        const int32_t value = pcm[i];
        const uint32_t absolute = value < 0 ? -value : value;
        if (absolute > result.peak) result.peak = absolute;
        squares += static_cast<uint64_t>(static_cast<int64_t>(value) * value);
    }
    result.rms = static_cast<uint32_t>(std::sqrt(
        static_cast<double>(squares) / samples));
    result.has_signal = result.peak > 0;
    return result;
}
}  // namespace nido
#endif
