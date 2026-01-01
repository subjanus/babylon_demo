
extends Node
class_name Network

signal connected(my_id)
signal state_update(players)

var my_id := ""

func on_socket_event(event_name: String, payload_json: String) -> void:
	var payload = JSON.parse_string(payload_json)
	if payload == null:
		return

	match event_name:
		"hello":
			my_id = str(payload.get("id", ""))
			emit_signal("connected", my_id)
		"state":
			emit_signal("state_update", payload.get("players", []))

func emit_join(name: String) -> void:
	_emit("join", {"name": name})

func emit_gps(lat: float, lon: float, t: int) -> void:
	_emit("gps", {"lat": lat, "lon": lon, "t": t})

func _emit(event: String, payload: Dictionary) -> void:
	if OS.get_name() != "Web":
		return
	JavaScriptBridge.eval(
		"window.godotEmit(%s, %s);" % [
			JSON.stringify(event),
			JSON.stringify(payload)
		]
	)
