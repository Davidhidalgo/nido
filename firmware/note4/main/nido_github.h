#pragma once
#include "nido_github_policy.h"
namespace nido {
bool GithubLatest(const char* current,GithubRelease& release,int64_t deadline);
bool GithubInstall(const GithubRelease& release);
}
