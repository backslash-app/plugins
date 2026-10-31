import { assert, assertEquals, assertThrows } from "@std/assert";
import {
  autoPartner,
  bestCapture,
  clamp,
  coarseStep,
  displayValue,
  explain,
  ffmpegArgs,
  formatSummary,
  isInactive,
  nextMenuValue,
  niceName,
  parseControls,
  parseDevices,
  parseFormats,
  parseInfo,
  parseResolution,
  parseValue,
  ratio,
  snapshotName,
  sortControls,
} from "./lib.ts";
import { pickCamera } from "./system.ts";

const DEVICES = `HD Pro Webcam C920 (usb-0000:00:14.0-1):
	/dev/video0
	/dev/video1
	/dev/media0

Integrated Camera: Integrated C (usb-0000:00:14.0-8):
	/dev/video2
	/dev/video3
	/dev/media1

bcm2835-codec-decode (platform:bcm2835-codec):
	/dev/video10
	/dev/media2

Cannot open device /dev/video4, exiting.
`;

Deno.test("v4l2-ctl --list-devices", () => {
  assertEquals(parseDevices(DEVICES), [
    { name: "HD Pro Webcam C920", bus: "usb-0000:00:14.0-1", nodes: ["/dev/video0", "/dev/video1"] },
    { name: "Integrated Camera: Integrated C", bus: "usb-0000:00:14.0-8", nodes: ["/dev/video2", "/dev/video3"] },
    { name: "bcm2835-codec-decode", bus: "platform:bcm2835-codec", nodes: ["/dev/video10"] },
  ]);
  assertEquals(parseDevices(""), []);
});

const INFO_CAPTURE = `Driver Info:
	Driver name      : uvcvideo
	Card type        : HD Pro Webcam C920
	Bus info         : usb-0000:00:14.0-1
	Driver version   : 6.8.12
	Capabilities     : 0x84a00001
		Video Capture
		Metadata Capture
		Streaming
		Extended Pix Format
		Device Capabilities
	Device Caps      : 0x04200001
		Video Capture
		Streaming
		Extended Pix Format
Media Driver Info:
	Driver name      : uvcvideo
`;

const INFO_METADATA = `Driver Info:
	Driver name      : uvcvideo
	Card type        : HD Pro Webcam C920
	Capabilities     : 0x84a00001
		Video Capture
		Metadata Capture
		Streaming
		Extended Pix Format
		Device Capabilities
	Device Caps      : 0x04a00000
		Metadata Capture
		Streaming
		Extended Pix Format
`;

Deno.test("which node captures video", () => {
  assertEquals(parseInfo(INFO_CAPTURE), { driver: "uvcvideo", card: "HD Pro Webcam C920", capture: true });
  assertEquals(parseInfo(INFO_METADATA).capture, false);
  assertEquals(parseInfo("").capture, false);
});

// v4l2-ctl 1.26 --list-ctrls-menus on a Logitech C920
const CTRLS = `
User Controls

                     brightness 0x00980900 (int)    : min=0 max=255 step=1 default=128 value=150
                       contrast 0x00980901 (int)    : min=0 max=255 step=1 default=128 value=128
        white_balance_automatic 0x0098090c (bool)   : default=1 value=1
           power_line_frequency 0x00980918 (menu)   : min=0 max=2 default=2 value=2 (60 Hz)
				0: Disabled
				1: 50 Hz
				2: 60 Hz
      white_balance_temperature 0x0098091a (int)    : min=2000 max=6500 step=1 default=4000 value=4000 flags=inactive
                      sharpness 0x0098091b (int)    : min=0 max=255 step=1 default=128 value=128

Camera Controls

                  auto_exposure 0x009a0901 (menu)   : min=0 max=3 default=3 value=3 (Aperture Priority Mode)
				1: Manual Mode
				3: Aperture Priority Mode
         exposure_time_absolute 0x009a0902 (int)    : min=3 max=2047 step=1 default=250 value=250 flags=inactive
     exposure_dynamic_framerate 0x009a0903 (bool)   : default=0 value=1
                 focus_absolute 0x009a090a (int)    : min=0 max=250 step=5 default=0 value=0 flags=inactive
     focus_automatic_continuous 0x009a090c (bool)   : default=1 value=1
                  zoom_absolute 0x009a090d (int)    : min=100 max=500 step=1 default=100 value=100
`;

// Older v4l2-ctl: no hex ids, old control names
const OLD = `                     brightness (int)    : min=-64 max=64 step=1 default=0 value=0
                  exposure_auto (menu)   : min=0 max=3 default=3 value=1
              exposure_absolute (int)    : min=1 max=5000 step=1 default=156 value=156
                     focus_auto (bool)   : default=1 value=1
                   privacy 0x009a0910 (bool)   : default=0 value=0 flags=read-only, volatile
`;

Deno.test("controls: types, ranges, menus, flags, sections", () => {
  const c = parseControls(CTRLS);
  assertEquals(c.length, 12);
  assertEquals(c[0], {
    name: "brightness",
    type: "int",
    section: "User Controls",
    min: 0,
    max: 255,
    step: 1,
    default: 128,
    value: 150,
    valueLabel: undefined,
    flags: [],
    menu: [],
  });
  const plf = c.find((x) => x.name === "power_line_frequency")!;
  assertEquals(plf.valueLabel, "60 Hz");
  assertEquals(plf.menu.map((m) => m.label), ["Disabled", "50 Hz", "60 Hz"]);
  const ae = c.find((x) => x.name === "auto_exposure")!;
  assertEquals(ae.section, "Camera Controls");
  assertEquals(ae.menu, [{ value: 1, label: "Manual Mode" }, { value: 3, label: "Aperture Priority Mode" }]);
  assert(isInactive(c.find((x) => x.name === "exposure_time_absolute")!));
  assertEquals(c.find((x) => x.name === "focus_absolute")!.step, 5);

  const old = parseControls(OLD);
  assertEquals(old.map((x) => x.name), ["brightness", "exposure_auto", "exposure_absolute", "focus_auto", "privacy"]);
  assertEquals(old[0].min, -64);
  assertEquals(old[4].flags, ["read-only", "volatile"]);
  assertEquals(old[1].valueLabel, undefined);
});

Deno.test("automatic modes, steps, values", () => {
  const c = parseControls(CTRLS);
  const get = (n: string) => c.find((x) => x.name === n)!;
  assertEquals(autoPartner("exposure_time_absolute", c)?.control.name, "auto_exposure");
  assertEquals(autoPartner("exposure_time_absolute", c)?.manual, 1);
  assertEquals(autoPartner("focus_absolute", c)?.manual, 0);
  assertEquals(autoPartner("white_balance_temperature", c)?.control.name, "white_balance_automatic");
  assertEquals(autoPartner("exposure_absolute", parseControls(OLD))?.control.name, "exposure_auto");
  assertEquals(autoPartner("brightness", c), undefined);

  assertEquals(coarseStep(get("brightness")), 13);
  assertEquals(coarseStep(get("focus_absolute")), 15);
  assertEquals(clamp(get("brightness"), 300), 255);
  assertEquals(clamp(get("focus_absolute"), 12), 10);
  assertEquals(clamp(get("zoom_absolute"), 50), 100);
  assertEquals(ratio(get("zoom_absolute")), 0);
  assertEquals(displayValue(get("white_balance_automatic")), "on");
  assertEquals(displayValue(get("auto_exposure")), "Aperture Priority Mode");
  assertEquals(nextMenuValue(get("auto_exposure")), 1);
  assertEquals(nextMenuValue(get("power_line_frequency")), 0);

  assertEquals(parseValue(get("brightness"), " 200 "), 200);
  assertThrows(() => parseValue(get("brightness"), "300"), Error, "Brightness goes from 0 to 255");
  assertThrows(() => parseValue(get("brightness"), "bright"), Error, "not a whole number");
  assertEquals(parseValue(get("auto_exposure"), "manual mode"), 1);
  assertThrows(() => parseValue(get("auto_exposure"), "2"), Error, "not one of the choices");
  assertEquals(parseValue(get("white_balance_automatic"), "off"), 0);
});

Deno.test("names and order", () => {
  assertEquals(niceName("exposure_time_absolute"), "Exposure");
  assertEquals(niceName("focus_automatic_continuous"), "Autofocus");
  assertEquals(niceName("iris_absolute"), "Iris");
  assertEquals(niceName("rotate"), "Rotate");
  const sorted = sortControls(parseControls(CTRLS)).map((c) => c.name);
  assertEquals(sorted.slice(0, 5), ["brightness", "contrast", "sharpness", "auto_exposure", "exposure_time_absolute"]);
});

const FORMATS = `ioctl: VIDIOC_ENUM_FMT
	Type: Video Capture

	[0]: 'YUYV' (YUYV 4:2:2)
		Size: Discrete 640x480
			Interval: Discrete 0.033s (30.000 fps)
			Interval: Discrete 0.067s (15.000 fps)
		Size: Discrete 1280x720
			Interval: Discrete 0.100s (10.000 fps)
	[1]: 'MJPG' (Motion-JPEG, compressed)
		Size: Discrete 640x480
			Interval: Discrete 0.033s (30.000 fps)
		Size: Discrete 1920x1080
			Interval: Discrete 0.033s (30.000 fps)
		Size: Discrete 1280x720
			Interval: Discrete 0.033s (30.000 fps)
`;

Deno.test("formats and what to capture", () => {
  const f = parseFormats(FORMATS);
  assertEquals(f.map((x) => x.fourcc), ["YUYV", "MJPG"]);
  assertEquals(f[0].sizes[0], { width: 640, height: 480, fps: [30, 15] });
  assertEquals(f[1].sizes.length, 3);
  assertEquals(bestCapture(f), { inputFormat: "mjpeg", size: "1920x1080" });
  assertEquals(bestCapture(f, "1280x720"), { inputFormat: "mjpeg", size: "1280x720" });
  assertEquals(bestCapture(f, "800x600"), { size: "800x600" });
  assertEquals(bestCapture(parseFormats(FORMATS.split("\t[1]")[0])), { inputFormat: "yuyv422", size: "1280x720" });
  assertEquals(bestCapture([]), {});
  assertEquals(formatSummary(f), "YUYV 1280×720 · MJPG 1920×1080");
  assertEquals(parseResolution("1920×1080"), "1920x1080");
  assertEquals(parseResolution("720p"), "1280x720");
  assertEquals(parseResolution(""), undefined);
  assertThrows(() => parseResolution("big"), Error, "not a resolution");
});

Deno.test("the ffmpeg snapshot command", () => {
  assertEquals(snapshotName(new Date(2026, 9, 31, 14, 5, 9)), "webcam-2026-10-31_14-05-09.jpg");
  assertEquals(ffmpegArgs("/dev/video0", "/p/x.jpg", { inputFormat: "mjpeg", size: "1920x1080" }, 10), [
    "-hide_banner",
    "-loglevel",
    "error",
    "-f",
    "v4l2",
    "-input_format",
    "mjpeg",
    "-video_size",
    "1920x1080",
    "-i",
    "/dev/video0",
    "-vf",
    "select=gte(n\\,10)",
    "-frames:v",
    "1",
    "-q:v",
    "2",
    "-update",
    "1",
    "-y",
    "/p/x.jpg",
  ]);
  assert(!ffmpegArgs("/dev/video0", "/p/x.jpg", {}, 0).includes("-vf"));
});

Deno.test("errors said for people", () => {
  assertEquals(
    explain(
      "ffmpeg exited with 1: [video4linux2,v4l2 @ 0x55] ioctl(VIDIOC_STREAMON): Device or resource busy\n/dev/video0: Device or resource busy",
    ),
    "The camera is in use by another app: close it and try again",
  );
  assert(explain("Cannot open device /dev/video0, exiting.").startsWith("The camera is gone"));
  assert(explain("/dev/video0: Permission denied").includes("video group"));
  assertEquals(explain("weird\nlast"), "last");
});

Deno.test("the camera from the preferences", () => {
  const cams = parseDevices(DEVICES).map((device) => ({
    device,
    node: device.nodes[0],
    info: { capture: true },
    formats: [],
  }));
  assertEquals(pickCamera(cams)?.node, "/dev/video0");
  assertEquals(pickCamera(cams, "/dev/video3")?.node, "/dev/video2");
  assertEquals(pickCamera(cams, "integrated")?.node, "/dev/video2");
  assertEquals(pickCamera(cams, "nope")?.node, "/dev/video0");
  assertEquals(pickCamera([], ""), undefined);
});
