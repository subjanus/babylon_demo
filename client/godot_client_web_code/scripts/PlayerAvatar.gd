
extends Node3D
class_name PlayerAvatar

var player_id := ""
var player_name := ""

@onready var mesh := MeshInstance3D.new()
@onready var label := Label3D.new()

func _ready():
	mesh.mesh = CapsuleMesh.new()
	add_child(mesh)

	label.text = player_name
	label.billboard = BaseMaterial3D.BILLBOARD_ENABLED
	label.position = Vector3(0, 2, 0)
	add_child(label)

func set_name_text(t: String):
	player_name = t
	label.text = t
