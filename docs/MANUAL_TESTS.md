# Manual test checklist

The automated tests use a fake `openrgb`. These steps need the real keyboard. Run them before each release.

1. Cold start: restart the shell (`omarchy restart shell`). With no saved state the keyboard must not change.
2. Open the panel. Pick each of the six modes. Each must visibly change the keyboard.
3. Static: click a preset, drag each RGB slider, type a hex value, turn Match theme on and off.
4. Brightness: step through 1 to 5. Five distinct levels should show. Note whether any two look the same.
5. Speed on Breathing: step through 1 to 3. Note which end is faster (not yet verified) and update the README.
6. Off, then On. On must return to the previous mode and colour.
7. Follow theme: switch themes in Omarchy. The keyboard colour must follow.
8. Persistence: set Breathing, then `omarchy restart shell`. The keyboard must come back as Breathing in the same colour.
9. Reboot. Same check as step 8.
10. Suspend and resume. Note whether the backlight survives. If not, it is a known limitation.
11. Errors, one at a time:
    - `sudo mv /usr/bin/openrgb /usr/bin/openrgb.off`, restart the shell: the panel shows "OpenRGB was not found". Move it back and press Check again.
    - Start a second RGB tool that holds the device and watch for timeouts.
12. Other machines: for each new laptop, record the USB id, the OpenRGB version and the result of steps 2 to 8 in the README table.
