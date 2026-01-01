
extends Node3D

@onready var avatars := $Avatars
var net: Network
var avatar_map := {}

func _ready():
	net = Network.new()
	add_child(net)
	net.connected.connect(_on_connected)
	net.state_update.connect(_on_state)

	if OS.get_name() == "Web":
		JavaScriptBridge.eval("window.startGodotNetAndGPS && window.startGodotNetAndGPS();")

func _on_connected(id):
	net.emit_join("Player-" + id.substr(0,4))

func _on_state(players):
	var seen := {}
	for p in players:
		var id = p.get("id", "")
		if id == "": continue
		seen[id] = true

		var av: PlayerAvatar
		if not avatar_map.has(id):
			av = PlayerAvatar.new()
			avatar_map[id] = av
			avatars.add_child(av)
		else:
			av = avatar_map[id]

		av.set_name_text(p.get("name", "Anon"))
		av.position = Vector3(p.get("x", 0.0), 0, p.get("z", 0.0))

	for id in avatar_map.keys():
		if not seen.has(id):
			avatar_map[id].queue_free()
			avatar_map.erase(id)

func on_gps(lat, lon, t):
	net.emit_gps(lat, lon, t)

func on_socket_event(event, payload):
	net.on_socket_event(event, payload)
