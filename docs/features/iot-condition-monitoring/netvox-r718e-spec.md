# Netvox R718E — verified payload spec

**Device:** Netvox R718E EU868 — LoRaWAN Class A, three-axis digital accelerometer (ADXL345, SPI)
+ external NTC surface-temperature sensor.

**Primary source:** the official Netvox payload codec published in the LoRaWAN Device Repository
(`TheThingsNetwork/lorawan-devices`, `vendor/netvox/payload/r718e.js`, Netvox-authored). Values
below were cross-checked against the codec's own example vectors. Do not "improve" the math — match
the codec exactly; the physical device emits exactly this.

## Frame

- Data reports arrive on **fPort 6**. Config/response frames use fPort 7. Anything else -> error.
- Every data frame is **11 bytes**: `byte[0]=Version`, `byte[1]=DeviceType`, `byte[2]=ReportType`,
  then payload.
- **DeviceType for R718E = `0x1C` (28)**.

## ReportType 0x00 — device info

`SWver = byte[3]/10`, `HWver = byte[4]`, `Datecode = hex(byte[5..8])`.

## ReportType 0x01 — battery + acceleration

- `byte[3]` = battery. If high bit `0x80` set -> low-battery flag, value `= (byte[3] & 0x7F)/10`,
  else `byte[3]/10` (volts).
- `AccelerationX = bfloat16(byte[5]<<8 | byte[4])` (little-endian 16-bit word).
- `AccelerationY = bfloat16(byte[7]<<8 | byte[6])`.
- `AccelerationZ = bfloat16(byte[9]<<8 | byte[8])`. Unit: g.

## ReportType 0x02 — velocity + temperature

- `VelocityX = bfloat16(byte[4]<<8 | byte[3])`.
- `VelocityY = bfloat16(byte[6]<<8 | byte[5])`.
- `VelocityZ = bfloat16(byte[8]<<8 | byte[7])`. Unit: mm/s.
- Temperature (only when DeviceType `0x1C`): raw `= byte[9]<<8 | byte[10]` (big-endian). If
  `byte[9] & 0x80` -> negative: `Temp = (0x10000 - raw)/10 * -1`, else `Temp = raw/10` (°C).

## bfloat16 (codec calls it `float32Process`)

Decodes the **top 16 bits of an IEEE-754 float32** (1 sign, 8 exponent, 7 mantissa):

```
sign = (h & 0x8000) >> 15
exp  = (h & 0x7F80) >> 7
frac = (h & 0x007F) << 16
value = (-1)^sign * 2^(exp-127) * (1 + frac/2^23)   // exp!=0
```

Encoding (inverse, for fixtures/simulation) = write the number as float32, take the high 16 bits.
Round-trip precision is ~7 mantissa bits — a real quantization the simulator inherits on purpose.

## Verified example vectors (from the codec)

- `fPort 6, bytes [01 1C 01 24 B3 40 B2 C0 6A 3E 00]` ->
  `Volt 3.6, AccelerationX 5.59375, AccelerationY -5.5625, AccelerationZ 0.228516`.
  (`bfloat16(0x40B3)=5.59375`, `bfloat16(0xC0B2)=-5.5625`, `bfloat16(0x3E6A)=0.228516`.)
- Temperature `bytes[9..10] = FF 97` -> `-10.5 °C`.

## What the condition-monitoring MVP uses

The **0x02 velocity+temperature** frame carries the core signals (velocityX/Y/Z + temperature).
Acceleration (0x01) and battery are optional detail metrics shown in the detail view.
</content>
