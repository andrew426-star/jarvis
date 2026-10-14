// Room Hub - Jarvis's hands in Andrew's dorm room (WEMOS ESP32).
//
// Every 3 s it checks in with Jarvis: POST /devices/state with what it
// senses and what it can do, and gets back the commands queued for it
// (app/services/home.py, app/tools/home.py). Nothing here touches mains:
// the lamp and fan plug into Digital Loggers IoT Power Relays, UL-listed
// outlets switched by a 3.3 V signal; the overhead light's wall rocker is
// pressed by a servo in a removable printed mount; the desk strip is 12 V
// through a logic-level MOSFET.
//
// Build in the Arduino IDE with the ESP32 core, ESP32Servo and ArduinoJson
// (v7). Fill in the four settings below.

#include <WiFi.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <ESP32Servo.h>

const char* WIFI_SSID = "your-network";
const char* WIFI_PASS = "your-password";
const char* BACKEND = "https://jarvis-u49p.onrender.com";
const char* DEVICE_TOKEN = "JARVIS_DEVICE_TOKEN value";
const char* DEVICE = "room-hub";

// Pins (ADC1 only for the analog inputs: ADC2 stops working with WiFi on).
const int PIN_LAMP = 16;      // IoT Power Relay 1, control +
const int PIN_FAN = 17;       // IoT Power Relay 2, control +
const int PIN_DESK = 25;      // MOSFET gate via 100 ohm (10k pull-down to GND)
const int PIN_SERVO = 26;     // wall-switch pusher
const int PIN_PIR = 32;       // open collector, LOW on motion
const int PIN_DOOR = 33;      // Hall sensor, LOW while the magnet (door) is near
const int PIN_LIGHT = 34;     // photoresistor divider
const int PIN_TEMP = 35;      // thermistor divider

// The wall rocker: rest clear of it, press the top for on, the bottom for off.
const int SERVO_REST = 90, SERVO_ON = 58, SERVO_OFF = 122;
const unsigned long CHECKIN_MS = 3000;
const unsigned long AWAY_MS = 20UL * 60UL * 1000UL;  // no motion this long = away

Servo pusher;
bool lamp = false, fan = false, overhead = false;
int desk = 0;  // 0-100 %
unsigned long lastMotion = 0, lastCheckin = 0;
bool doorWasOpen = false;

float readTempC() {
  // 3V3 - thermistor - pin - 10k - GND, B = 3950, 10k at 25 C.
  int raw = analogRead(PIN_TEMP);
  if (raw <= 0 || raw >= 4095) return NAN;
  float r = 10000.0 * (4095.0 / raw - 1.0);
  return 1.0 / (log(r / 10000.0) / 3950.0 + 1.0 / 298.15) - 273.15;
}

int readLightPct() {
  return map(analogRead(PIN_LIGHT), 0, 4095, 0, 100);
}

void pressSwitch(bool on) {
  pusher.attach(PIN_SERVO);
  pusher.write(on ? SERVO_ON : SERVO_OFF);
  delay(400);
  pusher.write(SERVO_REST);
  delay(400);
  pusher.detach();  // no holding current, no hum, the switch works by hand
  overhead = on;
}

void setDesk(int pct) {
  desk = constrain(pct, 0, 100);
  analogWrite(PIN_DESK, map(desk, 0, 100, 0, 255));
}

bool asOnOff(JsonVariant value) {
  if (value.is<bool>()) return value.as<bool>();
  String s = value.as<String>();
  s.toLowerCase();
  return s == "on" || s == "true" || s == "1";
}

void run(const char* action, JsonVariant value) {
  if (!strcmp(action, "lights")) { lamp = asOnOff(value); digitalWrite(PIN_LAMP, lamp); }
  else if (!strcmp(action, "fan")) { fan = asOnOff(value); digitalWrite(PIN_FAN, fan); }
  else if (!strcmp(action, "overhead")) { pressSwitch(asOnOff(value)); }
  else if (!strcmp(action, "desk")) { setDesk(value.is<int>() ? value.as<int>() : (asOnOff(value) ? 100 : 0)); }
}

void post(const char* path, const String& body, String* reply) {
  if (WiFi.status() != WL_CONNECTED) return;
  HTTPClient http;
  http.begin(String(BACKEND) + path);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("Authorization", String("Bearer ") + DEVICE_TOKEN);
  http.setTimeout(8000);
  int code = http.POST(body);
  if (code == 200 && reply) *reply = http.getString();
  else if (code != 200) Serial.printf("%s -> %d\n", path, code);
  http.end();
}

void checkIn() {
  bool doorOpen = digitalRead(PIN_DOOR) == HIGH;
  bool away = millis() - lastMotion > AWAY_MS;

  JsonDocument doc;
  doc["device"] = DEVICE;
  JsonObject state = doc["state"].to<JsonObject>();
  float t = readTempC();
  if (!isnan(t)) state["temp_c"] = round(t * 10) / 10.0;
  state["light_pct"] = readLightPct();
  state["door"] = doorOpen ? "open" : "closed";
  state["occupied"] = !away;
  state["lights"] = lamp ? "on" : "off";
  state["fan"] = fan ? "on" : "off";
  state["overhead"] = overhead ? "on" : "off";
  state["desk"] = desk;
  JsonArray caps = doc["capabilities"].to<JsonArray>();
  for (const char* c : {"lights", "fan", "overhead", "desk"}) caps.add(c);

  String body, reply;
  serializeJson(doc, body);
  post("/devices/state", body, &reply);

  JsonDocument answer;
  if (reply.length() && !deserializeJson(answer, reply)) {
    for (JsonObject command : answer["commands"].as<JsonArray>()) run(command["action"], command["value"]);
  }
}

void alertDoor() {
  JsonDocument doc;
  doc["device"] = DEVICE;
  doc["title"] = "Door opened";
  doc["body"] = "Your room door opened with no one in for 20 minutes.";
  doc["priority"] = "high";
  String body;
  serializeJson(doc, body);
  post("/devices/event", body, nullptr);
}

void setup() {
  Serial.begin(115200);
  pinMode(PIN_LAMP, OUTPUT);
  pinMode(PIN_FAN, OUTPUT);
  pinMode(PIN_DESK, OUTPUT);
  pinMode(PIN_PIR, INPUT_PULLUP);
  pinMode(PIN_DOOR, INPUT_PULLUP);
  analogSetAttenuation(ADC_11db);  // full 0-3.3 V range on the dividers
  setDesk(0);
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  delay(2000);  // the PIR settles at power-on
  lastMotion = millis();
}

void loop() {
  if (WiFi.status() != WL_CONNECTED) {
    WiFi.reconnect();
    delay(1000);
  }
  if (digitalRead(PIN_PIR) == LOW) lastMotion = millis();

  bool doorOpen = digitalRead(PIN_DOOR) == HIGH;
  if (doorOpen && !doorWasOpen && millis() - lastMotion > AWAY_MS) alertDoor();
  doorWasOpen = doorOpen;

  if (millis() - lastCheckin >= CHECKIN_MS) {
    lastCheckin = millis();
    checkIn();
  }
  delay(50);
}
