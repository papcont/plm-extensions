# GOAL — IoT / Condition Monitoring (immutable target)

Add a production-shaped, modular IoT / condition-monitoring capability to the Fusion Manage
Extensions server. Short term: a **hardware-independent MVP driven by a simulator**. Long term:
attach real wireless sensors (first **Netvox R718E EU868 via a SenseCAP M2 LoRaWAN gateway**)
by placing the real source in front of the *already finished* ingestion layer — without rewriting
Tandem, Fusion Manage, UI, health/condition logic, or the data model.

## Target chain (today — simulation)

```
Virtual Netvox R718E
  -> simulated LoRaWAN / The Things Stack uplink
  -> IoT Bridge
  -> Canonical Telemetry Model
  -> Autodesk Tandem (time series)  +  Fusion Manage (asset / condition)
  -> FM Extension: Condition-Monitoring UI (charts / health / alerts / maintenance)
```

## Central architectural principle

Vendor / transport formats MUST NOT propagate through the app. One boundary:

```
DEVICE / TRANSPORT FORMAT  ->  Device Adapter / Decoder  ->  CANONICAL TELEMETRY EVENT  ->  Domain / Analytics / Autodesk integrations
```

No logic beyond the device adapter may depend on whether data came from the simulator, a Netvox
R718E, Advantech WISE-2410, MQTT, OPC UA, or another LoRaWAN sensor.

## Most important acceptance criterion

> When the Netvox R718E + SenseCAP M2 arrive, the real hardware is added only as a new real source
> in front of the finished IoT ingestion layer. Tandem integration, Fusion Manage integration,
> health/condition logic, the data model, and the extension UI stay unchanged.

## Definition of Done (MVP)

1. Existing extensions project still works.
2. A virtual `MOTOR-DEMO-001` can be simulated.
3. Several reproducible machine states exist.
4. A canonical telemetry model exists (versioned).
5. A Netvox R718E adapter is implemented from a verified spec.
6. A The Things Stack uplink can be processed.
7. Simulated readings reach the time-series layer (Tandem or its MVP stand-in).
8. Tandem is used as the time-series layer (gated; in-memory store as MVP stand-in).
9. Fusion Manage receives only asset/condition summaries + condition events (gated).
10. The extension shows a clear condition-monitoring dashboard.
11. Healthy -> Warning -> Critical -> Recovery is demonstrable.
12. Automated tests cover that path.
13. Simulator and the later real sensor are interchangeable behind the same adapter boundary.
14. It is documented which few steps remain after R718E + SenseCAP M2 are delivered.
</content>
</invoke>
