# Runbook - what to do next, step by step

Copy-paste instructions for the person with the watch. No prior context needed. Each task
says what it is for, exactly what to type, what a good result looks like, and what to send
back.

This file is the current task list and gets rewritten as tasks are done. `HANDOFF.md` is the
reasoning behind it; you do not need to read it to follow this.

**Where:** the **Linux Mint** side of the X230, in a terminal. Not Windows. Windows stays
useful only for making SuuntoLink captures.

**Golden rule:** every command below is safe except the ones in task 3, which are clearly
marked. Nothing in tasks 0 to 2 writes anything to the watch.

---

## Task 0 - one-time setup (15 min, do this once)

### 0.1 Get the code

```
cd ~
git clone git@github.com:vincentchalamon/ambit-app.git
cd ambit-app
```

If `git clone` complains about permissions, use the HTTPS address instead:
`git clone https://github.com/vincentchalamon/ambit-app.git`

Later, to get the latest version, just:

```
cd ~/ambit-app
git pull
```

### 0.2 Get the data files

The repository deliberately contains no captures and no Suunto files. Ask Vincent for the
`assets/` folder and unpack it so that it sits **inside** `~/ambit-app`, like this:

```
~/ambit-app/assets/ambit3 pcap/route12km        <- and the 8 other captures
~/ambit-app/assets/descr+XXXXXXXX+2.4.17        <- the SuuntoLink schema file
```

Check it landed in the right place:

```
cd ~/ambit-app
ls assets/ambit3\ pcap/ | head
ls assets/descr+*
```

Both commands must print file names. If the second one prints
`ls: cannot access 'assets/descr+*'`, the schema file is missing and task 1 will refuse to
run - that is deliberate, it would otherwise give you a wrong answer.

### 0.3 Install what is needed

```
sudo apt update
sudo apt install -y python3 build-essential libhidapi-hidraw0 python3-hid
```

That is all. `build-essential` is for the `make` in 0.4, the other two are for talking to the
watch over USB.

### 0.4 Check everything works

```
cd ~/ambit-app
make -C csrc
python3 tools/selftest.py
```

**Good result:** the last line says `19/19 checks pass`.

**If it says `captures not found`:** the `assets/` folder is not in the right place, go back
to 0.2.

**If some lines say `skip`:** that is fine, it means an optional piece is missing, and the
count will be lower than 19. Send the output and we will tell you if it matters.

### 0.5 Check the watch is reachable

Plug the watch in with its cable, then:

```
lsusb | grep 1493
```

**Good result:** one line containing `ID 1493:` and your watch. `1493` is Suunto's vendor
number.

**If nothing prints:** the cable, the port, or the watch is asleep. Try another USB port and
press a button on the watch.

Then the real test, which is the tool itself:

```
cd ~/ambit-app
./tools/write_nav.py settings --redact
```

Task 1 explains what the output means. For now, only one thing matters:

**If it says `no Ambit3 found on the USB bus`** while `lsusb` does show the watch, then your
user is not allowed to talk to it. openambit is already installed so this is unlikely, but the
fix is:

```
echo 'SUBSYSTEM=="hidraw", ATTRS{idVendor}=="1493", MODE="0666"' | sudo tee /etc/udev/rules.d/99-suunto.rules
sudo udevadm control --reload-rules
```

Unplug the watch, plug it back in, and run the command again.

---

## Task 1 - the `IsNspCapable` question (10 min, nothing is written)

**Why:** last time you re-paired the watch and read its Bluetooth settings, one field came
back as `IsNspCapable=0`, whereas the old capture had `1` everywhere. We need to know whether
that field just records *how* the pairing was made, or whether it is a switch that decides if
we can use the key at all. The difference matters a lot, and one test settles it.

**The idea:** last time you paired from the iPhone's Bluetooth settings. This time, pair from
*inside the Suunto app*, and see whether the field becomes `1`.

### 1.1 Read the current state first, before touching anything

Plug the watch in, then:

```
cd ~/ambit-app
./tools/write_nav.py settings --redact
```

**Good result:** the last lines say something like
`1 BLE bond(s) carrying a key out of 8 slot(s)` and
`Key material is redacted, so this output is safe to send as is`.

`--redact` replaces your keys and your phone's address with a fingerprint like
`EncodingKey=<16 bytes, sha256:75ca2f70>`. That fingerprint is enough for us to tell whether
a key changed between two reads, and useless to anyone else. **Always use `--redact` when you
are going to send us the output.**

Save it:

```
./tools/write_nav.py settings --redact > ~/read-1-before.txt
```

**If it says `CANNOT DECIDE`:** the schema file from 0.2 is missing. Fix that first, the
answer would be meaningless otherwise.

**If it says `no Ambit3 found on the USB bus`:** the cable or the permissions, see 0.5.

### 1.2 Unpair the watch from the phone

Three places, all of them:

1. On the iPhone: **Settings > Bluetooth**, find the watch, tap the blue `i`, then
   **Forget This Device**.
2. In the **Suunto app**, if it lists the watch, remove it there too.
3. On the watch itself: it has a pairing menu that can clear known devices. If you cannot
   find it, skip this one, it is not essential.

### 1.3 Pair again, but from inside the Suunto app

Open the **Suunto app** on the iPhone and pair the watch from there, not from iOS Settings.

**If the Suunto app refuses to pair an Ambit3, or does not offer it at all: stop and tell us.
That is a result, not a failure** - it means nobody can set that field through an app any
more, and we will have to write it ourselves.

### 1.4 Read again

```
cd ~/ambit-app
./tools/write_nav.py settings --redact > ~/read-2-after.txt
cat ~/read-2-after.txt
```

### 1.5 What to send back

Send both files, `read-1-before.txt` and `read-2-after.txt`. They are already safe to send.

The single thing we are looking for is the value of `IsNspCapable` on the line that has a
`sha256:` fingerprint for `EncodingKey`:

- **`IsNspCapable=1`** - good news, the field just records how the pairing was made.
- **`IsNspCapable=0`** - the field means something else and we have more work to do.

Either way it is a useful answer, so do not worry about which one you get.

---

## Task 2 - back up what is on the watch (20 min, by hand, nothing is written)

**Why:** task 3 erases every route and every waypoint on the watch. There is no undo, and no
way to read them back yet. So they get written down on paper first.

On the watch, go through the navigation menus and note, for each route: its **name**, and
roughly where it goes. For each POI or waypoint: its **name** and its **coordinates**, which
the watch can display.

If that is a lot of entries, photograph the screens instead. The point is only to be able to
put them back later.

You can also see what the old capture thought was on the watch, which may jog your memory:

```
cd ~/ambit-app
./tools/decode_route.py "assets/ambit3 pcap/ambit3full" | head -40
```

Tell us when this is done, and confirm in writing that you accept losing what is on the
watch. Then, and only then, task 3.

---

## Task 3 - the first real write (30 min, THIS ERASES THE WATCH'S ROUTES)

Do not start this before task 2 is finished.

**Why:** everything is ready in software and verified byte for byte against your own
captures, but nothing has ever been sent to a real watch. This is the moment we find out
whether the whole thing works. It is the milestone that turns the project into a usable app.

**Two rules:**

- Never pass `--write` to any command that mentions `firmware`. There is no such command in
  this runbook. Writing firmware is the only operation that can permanently kill the watch.
- If the watch reboots, freezes, or behaves oddly, stop and tell us. Do not retry.

### 3.1 Rehearsal, nothing is sent

```
cd ~/ambit-app
./tools/write_nav.py reset --compare "assets/ambit3 pcap/routedelete"
```

**Good result:** the last line is
`OK    4 0x0b16/0x0b18 payloads compared to assets/ambit3 pcap/routedelete`.

Just above it you will also see
`INFO  message 3 0x0b18: bytes [4, 5, 6, 7]  (word supplied by the application)`. That is
expected and not an error: it is the one 4-byte field of the protocol we never identified, and
it is not part of what we send.

This proves the bytes we are about to send are the exact bytes SuuntoLink sent when *you*
deleted a route. If the last line is not `OK`, stop and send the output.

### 3.2 The real write

The watch plugged in, and:

```
./tools/write_nav.py reset --write
```

**What you should see:** a short list of `-> 0x...` lines and no error. The command prints
nothing about success, because the watch answers nothing at all to a write. That silence is
normal.

### 3.3 Look at the watch

Go to the navigation menu on the watch.

- **The route list is empty:** it worked. This is the result we want. Tell us.
- **The routes are still there:** the write was rejected. Also a useful result, tell us.
- **The POI list:** tell us whether the POIs survived. We think they should, and we would
  like to know.

### 3.4 Check from the computer

```
./tools/write_nav.py settings --redact | head -3
```

If that still answers, the watch is alive and talking, which is the main thing.

### 3.5 Send back

- what the watch's navigation menu shows now, routes and POIs;
- the terminal output of 3.2, all of it;
- anything odd the watch did.

Then we move on to writing a real route, which is the same procedure with one more command.

---

## How to send results

Plain text is perfect. For terminal output, select it and paste it into the message.

Two habits that save time:

- for anything involving Bluetooth, use `--redact`, as in task 1;
- when a command fails, send **all** of its output, not just the last line. The interesting
  part is usually in the middle.

## If you are stuck

Send the command you typed and everything it printed. There is no wrong question, and a
command that fails is information, not a mistake.
