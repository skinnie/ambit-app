/*
 * HIDAPI Android implementation — wraps an Android USB FileDescriptor.
 *
 * On Android, the UsbDeviceConnection gives us a raw usbdevfs fd.
 * We use ioctl(USBDEVFS_BULK) to send/receive data on the interrupt
 * IN and OUT endpoints, bypassing the kernel HID subsystem.
 *
 * Only the functions actually called by libambit's protocol.c are
 * implemented. All others are stubs.
 */

#include "hidapi.h"

#include <stdlib.h>
#include <string.h>
#include <errno.h>
#include <sys/ioctl.h>
#include <linux/usbdevice_fs.h>

/* USBDEVFS_INTERRUPT may not be defined in older NDK kernel headers.
 * Defined in linux/usbdevice_fs.h as _IOWR('U', 18, struct usbdevfs_bulktransfer).
 * Same struct as USBDEVFS_BULK but correct ioctl number for interrupt endpoints. */
#ifndef USBDEVFS_INTERRUPT
#define USBDEVFS_INTERRUPT _IOWR('U', 18, struct usbdevfs_bulktransfer)
#endif

/* ─── hid_device struct ──────────────────────────────────────────────────── */

struct hid_device_ {
    int fd;          /* Android USB FileDescriptor */
    int ep_in;       /* Interrupt IN endpoint address  (e.g. 0x81) */
    int ep_out;      /* Interrupt OUT endpoint address (e.g. 0x01), or -1 */
    int blocking;    /* 1 = blocking, 0 = non-blocking */
};

/* ─── Android-specific constructor ──────────────────────────────────────── */

/**
 * Create an hid_device from an Android USB FileDescriptor + endpoint addresses.
 * Called from jni_bridge.cpp (nativeAmbitInit).
 */
hid_device *hid_open_from_fd(int fd, int ep_in, int ep_out)
{
    hid_device *dev = (hid_device *)calloc(1, sizeof(hid_device));
    if (!dev) return NULL;
    dev->fd     = fd;
    dev->ep_in  = ep_in;
    dev->ep_out = ep_out;
    dev->blocking = 1;   /* default: blocking */
    return dev;
}

/* ─── HIDAPI interface ───────────────────────────────────────────────────── */

int hid_init(void) { return 0; }
int hid_exit(void) { return 0; }

struct hid_device_info *hid_enumerate(unsigned short vendor_id, unsigned short product_id)
{
    (void)vendor_id; (void)product_id;
    return NULL;  /* not needed on Android */
}

void hid_free_enumeration(struct hid_device_info *devs) { (void)devs; }

hid_device *hid_open(unsigned short vendor_id, unsigned short product_id,
                     const wchar_t *serial_number)
{
    (void)vendor_id; (void)product_id; (void)serial_number;
    return NULL;  /* use hid_open_from_fd() instead */
}

hid_device *hid_open_path(const char *path)
{
    (void)path;
    return NULL;  /* use hid_open_from_fd() instead */
}

void hid_close(hid_device *dev)
{
    /* Do NOT close dev->fd — managed by Kotlin UsbDeviceConnection */
    free(dev);
}

int hid_set_nonblocking(hid_device *dev, int nonblock)
{
    if (!dev) return -1;
    dev->blocking = !nonblock;
    return 0;
}

/**
 * Write to the interrupt OUT endpoint.
 * Suunto Ambit uses HID interrupt endpoints → USBDEVFS_INTERRUPT (not BULK).
 * If no OUT endpoint, fall back to a HID Set_Report control transfer.
 */
int hid_write(hid_device *dev, const unsigned char *data, size_t length)
{
    if (!dev) return -1;

    if (dev->ep_out >= 0) {
        struct usbdevfs_bulktransfer bulk;
        memset(&bulk, 0, sizeof(bulk));
        bulk.ep      = (unsigned int)dev->ep_out;
        bulk.len     = (unsigned int)length;
        bulk.timeout = 5000;  /* ms */
        bulk.data    = (void *)data;
        /* Android uses USBDEVFS_BULK even for interrupt endpoints
         * (same as UsbDeviceConnection.bulkTransfer() in Java) */
        return ioctl(dev->fd, USBDEVFS_BULK, &bulk);
    }

    /* No OUT endpoint: HID Set_Report via control transfer */
    struct usbdevfs_ctrltransfer ctrl;
    memset(&ctrl, 0, sizeof(ctrl));
    ctrl.bRequestType = 0x21;     /* Host→Device | Class | Interface */
    ctrl.bRequest     = 0x09;     /* SET_REPORT */
    ctrl.wValue       = 0x0200;   /* Report Type=Output (0x02), Report ID=0 */
    ctrl.wIndex       = 0x0000;   /* Interface 0 */
    ctrl.wLength      = (uint16_t)length;
    ctrl.timeout      = 5000;
    ctrl.data         = (void *)data;
    return ioctl(dev->fd, USBDEVFS_CONTROL, &ctrl);
}

/**
 * Read from the interrupt IN endpoint.
 * Suunto Ambit uses HID interrupt endpoints → USBDEVFS_INTERRUPT (not BULK).
 * Returns >0 if data received, 0 if no data (non-blocking / timeout), -1 on error.
 */
int hid_read(hid_device *dev, unsigned char *data, size_t length)
{
    if (!dev) return -1;

    struct usbdevfs_bulktransfer bulk;
    memset(&bulk, 0, sizeof(bulk));
    bulk.ep      = (unsigned int)dev->ep_in;
    bulk.len     = (unsigned int)length;
    bulk.data    = data;
    /* Non-blocking: short timeout so protocol.c poll loop can usleep between retries.
     * Blocking: long timeout matching READ_TIMEOUT in protocol.c (20 000 ms). */
    bulk.timeout = dev->blocking ? 20000 : 100;

    int ret = ioctl(dev->fd, USBDEVFS_BULK, &bulk);
    if (ret < 0) {
        /* ETIMEDOUT / EINTR / EAGAIN = no data yet, return 0 for non-blocking */
        if (errno == ETIMEDOUT || errno == EINTR || errno == EAGAIN)
            return 0;
        return -1;
    }
    return ret;
}

int hid_read_timeout(hid_device *dev, unsigned char *data, size_t length, int milliseconds)
{
    if (!dev) return -1;
    struct usbdevfs_bulktransfer bulk;
    memset(&bulk, 0, sizeof(bulk));
    bulk.ep      = (unsigned int)dev->ep_in;
    bulk.len     = (unsigned int)length;
    bulk.timeout = (unsigned int)(milliseconds < 0 ? 20000 : milliseconds);
    bulk.data    = data;
    int ret = ioctl(dev->fd, USBDEVFS_BULK, &bulk);
    if (ret < 0) {
        if (errno == ETIMEDOUT || errno == EINTR) return 0;
        return -1;
    }
    return ret;
}

/* ─── Stubs (not needed by libambit) ────────────────────────────────────── */

int hid_send_feature_report(hid_device *dev, const unsigned char *data, size_t length)
{
    (void)dev; (void)data; (void)length;
    return -1;
}

int hid_get_feature_report(hid_device *dev, unsigned char *data, size_t length)
{
    (void)dev; (void)data; (void)length;
    return -1;
}

int hid_get_manufacturer_string(hid_device *dev, wchar_t *str, size_t maxlen)
{
    (void)dev; (void)str; (void)maxlen;
    return -1;
}

int hid_get_product_string(hid_device *dev, wchar_t *str, size_t maxlen)
{
    (void)dev; (void)str; (void)maxlen;
    return -1;
}

int hid_get_serial_number_string(hid_device *dev, wchar_t *str, size_t maxlen)
{
    (void)dev; (void)str; (void)maxlen;
    return -1;
}

int hid_get_indexed_string(hid_device *dev, int idx, wchar_t *str, size_t maxlen)
{
    (void)dev; (void)idx; (void)str; (void)maxlen;
    return -1;
}

const wchar_t *hid_error(hid_device *dev)
{
    (void)dev;
    return NULL;
}
