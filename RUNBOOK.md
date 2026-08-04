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

**Where we are:** tasks 0 to 3 are done. The first real write reached the watch on 2026-08-04
and the routes disappeared from it, which is the milestone this project existed to reach.
**Task 4 is what is next**: writing a real route rather than an erasure.

---

## Task 0 - one-time setup (15 min, do this once)

### 0.1 Get the code

```
cd ~
git clone https://github.com/vincentchalamon/ambit-app.git
cd ambit-app
```

If you have an SSH key set up on GitHub you can use
`git clone git@github.com:vincentchalamon/ambit-app.git` instead. The HTTPS address above
needs nothing set up, so prefer it.

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

That is all, on Mint and on Ubuntu. `build-essential` provides the `make` used in 0.4, and
the other two are what lets Python talk to the watch over USB.

Check it took:

```
python3 -c "import hid; print('hid module OK')"
```

**Good result:** it prints `hid module OK`.

**If it prints `ModuleNotFoundError: No module named 'hid'`,** or if `apt` said it could not
find `python3-hid` because you are not on Mint or Ubuntu, go to 0.3a.

### 0.3a Fallback: a private Python environment for this project

Skip this if 0.3 worked.

**Why:** recent Linux distributions refuse to let `pip` install things next to the system's
own Python, so as to stop a stray package from breaking the operating system. Trying it
anyway gives an error mentioning `externally-managed-environment`. That is a fence, not a
fault. The way around it is a *virtual environment*: a private folder holding its own copy of
Python and its own packages, which cannot affect the rest of the machine.

Create one inside the repository and install into it:

```
cd ~/ambit-app
python3 -m venv venv
source venv/bin/activate
pip install hid
```

**Good result:** `pip` finishes without an error, and your prompt now begins with `(venv)`.
That prefix is how you know you are inside the environment.

**If `python3 -m venv venv` fails with a message about `ensurepip`,** the piece of Python
that creates environments is not installed. The error itself names the package to install,
and it is one of these two:

```
sudo apt install -y python3-venv
```

Then delete the half-made folder and try again:

```
rm -rf ~/ambit-app/venv
cd ~/ambit-app
python3 -m venv venv
source venv/bin/activate
pip install hid
```

**The one thing to remember about a venv:** it is not permanent. It applies to the terminal
window you activated it in, and nothing else. **Every time you open a new terminal**, before
running any command from this runbook:

```
cd ~/ambit-app
source venv/bin/activate
```

If you forget, `No module named 'hid'` comes back. That message means "you are outside the
environment", not "the install failed". Re-activate and carry on.

The `venv` folder is deliberately not tracked by git, so it will never get in the way of a
`git pull`.

### 0.3b If you see `module 'hid' has no attribute 'Device'`

That was a real bug on our side, fixed on 2026-08-04. Two different Python packages are both
imported as `hid` and their APIs differ; the tool used to require one of them and Mint ships
the other. It now accepts either. Update and the error goes away:

```
cd ~/ambit-app
git pull
```

If it persists after a `git pull`, send us the output of `python3 -c "import hid; print(hid.__file__)"`.

### 0.4 Check everything works

```
cd ~/ambit-app
make -C csrc
python3 tools/selftest.py
```

**Good result:** the last line says `20/20 checks pass`.

**If it says `captures not found`:** the `assets/` folder is not in the right place, go back
to 0.2.

**If some lines say `skip`:** that is fine, it means an optional piece is missing, and the
count will be lower than 20. Send the output and we will tell you if it matters.

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

Task 1 explains what the output means. Here, only the failures matter, and each one has a
different cause.

**If you get a `Traceback` with lines of Python in it,** your copy of the code is out of
date. Every failure the tool expects is reported as one readable sentence, never as a
traceback. Update and try again:

```
cd ~/ambit-app
git pull
./tools/write_nav.py settings --redact
```

**If it says `no Ambit3 on the USB bus`** while `lsusb` did show the watch: unusual, since
both look at the same place. Try another port, and send us both outputs.

**If it says `none of them openable`,** the watch is seen but your user is not allowed to
talk to it. That is the common one. The message prints the fix; this is the same thing with
a word of explanation.

Listing a USB device needs no permission, opening it does, and they are separate things -
which is why `lsusb` can succeed while the tool cannot. Look at the device nodes:

```
ls -l /dev/hidraw*
```

If they are owned by `root` with no permissions for anyone else, that is the whole problem.
Grant access:

```
echo 'SUBSYSTEM=="hidraw", ATTRS{idVendor}=="1493", MODE="0666"' | sudo tee /etc/udev/rules.d/99-suunto.rules
sudo udevadm control --reload-rules
```

**Unplug the watch and plug it back in** - the rule only applies to devices that appear after
it is loaded - then run the command again.

Do not assume openambit already took care of this. A rule written for openambit's own way of
reaching the watch covers a different device node than the one used here, so openambit can
work perfectly while this tool cannot.

---

## Task 1 - the `IsNspCapable` question: DONE, 2026-08-04

Nothing to do here. Kept for the record, since it explains what task 3 is for.

**The question was:** the watch stores a Bluetooth key for the phone, `EncodingKey`, and next
to it a flag `IsNspCapable`. An old capture had that flag at `1`; a fresh pairing gave `0`. Did
the flag simply record that the pairing had been made from the phone's Bluetooth settings
rather than from inside an app?

**The answer is no.** You paired from inside the Suunto app and it still read `0`. Two things
you found along the way made it more useful than a plain no:

- an **unpaired** watch does not appear in iOS Settings > Bluetooth at all, so pairing cannot
  be started from there and step 1.2 was impossible as written. Once the Suunto app has paired
  it, it does show up and can be forgotten from Settings. That asymmetry is a finding about
  iOS, not a mistake on your side, and it decides who owns the pairing flow in our future app;
- the flag is `0` on all eight slots, empty ones included, where the old capture had `1` on all
  eight.

So the flag is not something pairing sets, and we now know we have to write it ourselves. That
is part of a later task, and it needs the writing path proven first - which is task 3.

Thank you for the `--redact` output, it was exactly what was needed and it was safe to send as
is.

## Task 2 - back up what is on the watch: DONE, 2026-08-04

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

## Task 3 - the first real write: DONE, 2026-08-04

It worked. The routes disappeared from the watch, and the watch was still answering
afterwards. Kept short, for the record:

- the rehearsal matched the capture, `OK 4 0x0b16/0x0b18 payloads`;
- the watch's own memory map matched every address and size the project had assumed - the
  first time that was confirmed live rather than from a capture;
- 7 messages, 206 bytes, no error, and `settings` still answered afterwards.

**Your question, "not sure if it is good to delete gpsSGEE": nothing touched it.** Those three
`OK Waypoints / Routes / GpsSGEE` lines are a *check*, not a write: the tool asks the watch
where its regions are and compares the answer to what it expected. Your own output proves it.
The two writes were 14 and 40 bytes of payload, which is 8 bytes of header plus 6 and 32 bytes
of body - the two navigation region headers, at `0x005000` and `0x14c080`. `GpsSGEE` lives at
`0x0704e0` and was never addressed. Your AGPS data is intact.

**Your POIs, though, are our fault.** The documentation said omitting one message would leave
them alone. It said the opposite of the truth, and your run is what proved it: a navigation
write wipes the POI store, and that last message is what puts it back. Reading the capture
again with that in mind shows SuuntoLink asking for the POI list, wiping, then writing the
list back. The tool now does the same, and its version of that message reproduces the
capture's byte for byte, so this will not happen to anyone again.

That does not give you yours back, and you answered the question that decides how. Of the
three ways the watch accepts a POI - current position, typed coordinates, or the Suunto app
with "use on the watch" then a cable sync - **use the third one**. It is the only exact one:
no typing, and full precision. The watch's own entry screen takes five decimals where the
record stores seven, so anything typed by hand lands within about a metre and is not the same
POI you had.

**Do that before task 4, not after.** Task 4 asks whether the POIs survive a route write,
which is the fix from this task being tested. With an empty POI list that question has no
answer. Restore them first and the check becomes real.

We have not built a command to write POIs ourselves. It is a genuine gap, since the exact
route depends on the Suunto app and SuuntoLink and this project exists to do without them, but
it is not needed to finish task 4 and the format is fully known, so it is a short job when it
comes up rather than now.

---

## Task 4 - write a real route (30 min, overwrites the navigation database again)

**Why:** task 3 proved we can erase. This proves we can *create*, which is the whole point of
the project. Same machinery, one more command.

**First restore your POIs**, from the Suunto app with a cable sync, as described at the end of
task 3. Not for their own sake: 4.3 asks whether they survive a route write, and that question
needs some to survive.

The route we have the most evidence for is the 12 km one, and the tool can rehearse it against
the matching capture first.

### 4.1 Rehearsal, nothing is sent

```
cd ~/ambit-app
./tools/write_nav.py route "assets/ambit3 pcap/Gare-du-Nord-to-114-Av.-André-Morizet.gpx" \
    --meta "assets/ambit3 pcap/route12km" \
    --compare "assets/ambit3 pcap/route12km"
```

**Good result:** the last line is
`OK    13 0x0b16/0x0b18/0x0b25 payloads compared to assets/ambit3 pcap/route12km`.

That means every byte we would send matches what SuuntoLink sent for that same route, POI
restore included.

**One difference to expect between the rehearsal and the real thing.** The rehearsal counts 13
payloads because it borrows the POI list from the capture. Your watch has no POIs left, so the
real write will say `no POI to put back` and send 12. That is correct, not a fault: there is
nothing to preserve. Once you have POIs on the watch again, that message becomes the 13th
payload and they will survive.

### 4.2 The real write

```
./tools/write_nav.py route "assets/ambit3 pcap/Gare-du-Nord-to-114-Av.-André-Morizet.gpx" \
    --meta "assets/ambit3 pcap/route12km" --write
```

`--meta` supplies four values a GPX file does not contain - distance, ascent, descent and a
timestamp - by taking them from that capture. Without it the route still writes, with neutral
values we have never tested.

### 4.3 Look at the watch

Navigation menu. We want to know:

- is there a route named `Gare du Nord` in the list;
- can you open it, does it draw, does starting navigation work;
- how many waypoints does it show - we expect the route to have kept the ones the GPX marks;
- the POI list, which will still be empty unless you put something there first. The fix from
  task 3 only gets a real test once there is something to preserve.

### 4.4 Send back

The full terminal output of 4.2, and what the watch shows. A photo of the route on the watch
would be the nicest possible result to close this out.

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
