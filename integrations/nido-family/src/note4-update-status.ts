import { Note4GitHub, newerFirmware } from "./note4-github.js";

/** Advisory only: firmware still verifies and asks before installing in maintenance. */
export class Note4UpdateStatus {
  private nextCheck = 0;
  private version = "";
  private pending?: Promise<void>;
  constructor(
    private readonly latest: () => Promise<{ version: string }> = () =>
      new Note4GitHub({ repository: "Davidhidalgo/nido" }).latest(""),
    private readonly now: () => number = Date.now,
  ) {}
  status(installed?: string) {
    if (!this.pending && this.now() >= this.nextCheck) {
      this.nextCheck = this.now() + 60 * 60 * 1000;
      this.pending = Promise.resolve()
        .then(this.latest)
        .then(
          (release) => {
            this.version = release.version;
          },
          () => {
            /* Retain the last successful result; retry no sooner than one hour. */
          },
        )
        .finally(() => {
          this.pending = undefined;
        });
    }
    const updateAvailable = !!installed && newerFirmware(this.version, installed) === true;
    return { updateAvailable, availableVersion: updateAvailable ? this.version : "" };
  }
}
