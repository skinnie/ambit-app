CC      ?= gcc
CFLAGS  ?= -std=c99 -Wall -Wextra -Wpedantic -O2 -D_XOPEN_SOURCE=700
LDLIBS  += -lm

# device_driver_ambit3_navigation.c/h and device_driver_ambit3_sport_modes.c/h moved to
# ../shared/libambit/ (2026-08-08 repo consolidation) - the same files android/'s own vendored
# libambit/ was carrying byte-identical copies of (confirmed with `diff` before moving anything).
# One real copy now, referenced from both places instead of drifting silently the way it
# already had started to (android's copy had gained BLE additions this one hadn't).
SHARED  := ../shared/libambit

BUILD   := build
TARGET  := $(BUILD)/harness
SOURCES := $(SHARED)/device_driver_ambit3_navigation.c test/crypto.c test/harness.c

SM_TARGET  := $(BUILD)/sport_modes_harness
SM_SOURCES := $(SHARED)/device_driver_ambit3_sport_modes.c test/sport_modes_harness.c

all: $(TARGET) $(SM_TARGET)

$(TARGET): $(SOURCES) $(SHARED)/device_driver_ambit3_navigation.h test/crc16.h test/sha256.h
	@mkdir -p $(BUILD)
	$(CC) $(CFLAGS) -I$(SHARED) -Itest -o $@ $(SOURCES) $(LDLIBS)

$(SM_TARGET): $(SM_SOURCES) $(SHARED)/device_driver_ambit3_sport_modes.h
	@mkdir -p $(BUILD)
	$(CC) $(CFLAGS) -I$(SHARED) -o $@ $(SM_SOURCES)

test: $(TARGET) $(SM_TARGET)
	../tools/c_reference.py
	../tools/sport_modes_c_reference.py

clean:
	rm -rf $(BUILD)

.PHONY: all test clean
