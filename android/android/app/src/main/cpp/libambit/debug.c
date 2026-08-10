/*
 * (C) Copyright 2014 Emil Ljungdahl
 *
 * This file is part of libambit.
 *
 * libambit is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 *
 * Contributors:
 *
 */
#include "debug.h"

#include <stdarg.h>
#include <stdio.h>
#include <android/log.h>

/*
 * This Android build of libambit has no stdout/stderr attached to logcat,
 * so the original fprintf-based implementation was silently invisible.
 * Route through __android_log_vprint instead (tag "libambit").
 */
void debug_printf(debug_level_t level, const char *file, int line, const char *func, const char *fmt, ...)
{
    android_LogPriority prio;
    char prefixed[512];
    va_list ap;

    if (level == debug_level_err) {
        prio = ANDROID_LOG_ERROR;
    }
    else if (level == debug_level_warn) {
        prio = ANDROID_LOG_WARN;
    }
    else {
        prio = ANDROID_LOG_INFO;
    }

#ifdef DEBUG_PRINT_FILE_LINE
    snprintf(prefixed, sizeof(prefixed), "%s:%d %s(): %s", file, line, func, fmt);
#else
    (void)file; (void)line;
    snprintf(prefixed, sizeof(prefixed), "%s(): %s", func, fmt);
#endif

    va_start(ap, fmt);
    __android_log_vprint(prio, "libambit", prefixed, ap);
    va_end(ap);
}
