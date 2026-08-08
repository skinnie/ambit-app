/*
 * libambit Android bridge — creates an ambit_object_t from an Android
 * USB FileDescriptor, bypassing the desktop HIDAPI/libusb enumeration.
 *
 * Call libambit_new_from_fd() instead of libambit_new() on Android.
 */

#include "libambit.h"
#include "libambit_int.h"
#include "device_support.h"
#include "device_driver.h"

#include <stdlib.h>
#include <string.h>

/* Declared in hidapi/hid-android.c */
hid_device *hid_open_from_fd(int fd, int ep_in, int ep_out);

/**
 * Open an Ambit device from an Android USB FileDescriptor.
 *
 * @param fd     FileDescriptor from UsbDeviceConnection.getFileDescriptor()
 * @param ep_in  Interrupt IN endpoint address  (e.g. 0x81)
 * @param ep_out Interrupt OUT endpoint address (e.g. 0x01), or -1 if none
 * @param vid    Vendor ID  (0x1493 for Suunto)
 * @param pid    Product ID (0x001C for Ambit3 Sport, 0x0010 for Ambit 1, …)
 *
 * @return Opaque ambit_object_t* on success, NULL on failure.
 *         Caller must free with libambit_close().
 */
ambit_object_t *libambit_new_from_fd(int fd, int ep_in, int ep_out,
                                     uint16_t vid, uint16_t pid)
{
    const ambit_known_device_t *known = libambit_device_support_find_first(vid, pid);
    if (!known || !known->supported || !known->driver) {
        return NULL;
    }

    ambit_object_t *object = (ambit_object_t *)calloc(1, sizeof(*object));
    if (!object) return NULL;

    object->handle = hid_open_from_fd(fd, ep_in, ep_out);
    if (!object->handle) {
        free(object);
        return NULL;
    }

    object->device_info.vendor_id   = vid;
    object->device_info.product_id  = pid;
    object->device_info.is_supported = true;
    memcpy(&object->device_info.komposti_version,
           &known->komposti_version,
           sizeof(known->komposti_version));

    object->driver = known->driver;

    /* Non-blocking during init probe, then switch to blocking for comms */
    hid_set_nonblocking(object->handle, 1);
    if (object->driver->init != NULL) {
        object->driver->init(object, known->driver_param);
    }
    hid_set_nonblocking(object->handle, 1); /* keep non-blocking (protocol.c polls) */

    return object;
}
