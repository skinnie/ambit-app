CC      ?= gcc
CFLAGS  ?= -std=c99 -Wall -Wextra -Wpedantic -O2 -D_XOPEN_SOURCE=700
LDLIBS  += -lm

BUILD   := build
TARGET  := $(BUILD)/harness
SOURCES := device_driver_ambit3_navigation.c test/crypto.c test/harness.c

all: $(TARGET)

$(TARGET): $(SOURCES) device_driver_ambit3_navigation.h test/crc16.h test/sha256.h
	@mkdir -p $(BUILD)
	$(CC) $(CFLAGS) -Itest -o $@ $(SOURCES) $(LDLIBS)

test: $(TARGET)
	../tools/c_reference.py

clean:
	rm -rf $(BUILD)

.PHONY: all test clean
