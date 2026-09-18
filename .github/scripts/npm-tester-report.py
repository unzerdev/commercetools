"""Print what the Connect buildpack's npm-tester reported for a failed application.

`connect validate` runs each application's `npm test` inside the buildpack image, through its
`connect-tester` post-buildpack, and that tester writes its report into the build log as ONE escaped
JSON line per lifecycle phase. It also caps the captured `testOutput`, so the same prefix repeats per
phase and the interesting lines can be cut off entirely. Decode the escapes, drop the duplicates and
print what survived: it is the only place a suite that failed inside the container is visible.

Usage: npm-tester-report.py <path to .connect/<app>/build.log>
"""

import re
import sys

MAX_LINES = 120
ANSI = re.compile(r"\\u001b\[[0-9;]*m")


def decode(raw: str) -> str:
    # The tester's JSON payload is escaped a SECOND time on its way into the log line, so `\n`
    # arrives as a literal backslash-backslash-n. Collapse that first, or every decode below leaves a
    # stray backslash behind.
    body = (
        raw.replace("\\\\", "\\")
        .replace("\\n", "\n")
        .replace("\\t", "\t")
        .replace('\\"', '"')
        .replace("\\u003e", ">")
        .replace("\\u003c", "<")
    )
    return ANSI.sub("", body)


def main(path: str) -> int:
    with open(path, encoding="utf-8", errors="replace") as handle:
        log = handle.read()

    seen: set[str] = set()
    printed = 0
    for raw in re.findall(r"BuildPackID:npm-tester Status:Failed.*", log):
        for line in decode(raw).splitlines():
            line = line.rstrip()
            if not line or line in seen:
                continue
            seen.add(line)
            print(line)
            printed += 1
            if printed >= MAX_LINES:
                return 0
    if printed == 0:
        print("no npm-tester failure report found in", path)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1]))
