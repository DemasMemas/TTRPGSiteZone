from copy import deepcopy
import pytest
from app.models import MapChunk


@pytest.fixture
def editor(client,create_user,auth_headers):
    gm=create_user();h=auth_headers(gm)
    lobby=client.post('/lobbies/',headers=h,json={'name':'World history','map_type':'empty','chunks_width':2,'chunks_height':2}).json['id']
    client.get(f'/lobbies/{lobby}/chunks?min_chunk_x=0&max_chunk_x=1&min_chunk_y=0&max_chunk_y=1',headers=h)
    return lobby,h


def tile(lobby,x,z):
    return deepcopy(MapChunk.query.filter_by(lobby_id=lobby,chunk_x=x//32,chunk_y=z//32).first().data[z%32][x%32])


def reverse(command):
    result=deepcopy(command)
    for cell in result['cells']:cell['before'],cell['after']=cell['after'],cell['before']
    return result


def replay(client,case,command):
    lobby,h=case
    return client.post(f'/lobbies/{lobby}/world-editor/changes',headers=h,json=command)


def test_server_command_round_trips_exact_fields_and_absence(client,editor):
    lobby,h=editor;before=tile(lobby,31,12)
    result=client.patch(f'/lobbies/{lobby}/chunks/0/0/tile/31/12',headers=h,json={'height':1.234567,'radiation':.125,'name':None})
    command=result.json['command'];assert len(command['cells'])==1
    assert command['cells'][0]['before']['radiation']=={'present':False}
    after=tile(lobby,31,12)
    assert replay(client,editor,reverse(command)).status_code==200
    assert tile(lobby,31,12)==before
    assert replay(client,editor,command).status_code==200
    assert tile(lobby,31,12)==after


def test_group_move_has_source_target_snapshots_and_restores_indices(client,editor):
    lobby,h=editor
    objects=[{'type':'tree','name':'A','scale':.75,'rotation':12.345,'x':.125,'z':-.25},{'type':'house','name':'B','scale':1,'rotation':0}]
    client.patch(f'/lobbies/{lobby}/chunks/0/0/tile/31/10',headers=h,json={'objects':objects})
    before=[tile(lobby,31,10),tile(lobby,32,10)]
    payload={'edits':[{'source':{'tile_x':31,'tile_y':10,'index':i},'target':{'tile_x':32,'tile_y':10},'expected':obj,'changes':{'rotation':25.125}} for i,obj in enumerate(objects)]}
    result=client.post(f'/lobbies/{lobby}/world-objects/edit',headers=h,json=payload)
    assert result.status_code==200,result.json
    command=result.json['command'];assert len(command['cells'])==2
    after=[tile(lobby,31,10),tile(lobby,32,10)]
    assert replay(client,editor,reverse(command)).status_code==200
    assert [tile(lobby,31,10),tile(lobby,32,10)]==before
    assert replay(client,editor,command).status_code==200
    assert [tile(lobby,31,10),tile(lobby,32,10)]==after


def test_road_command_restores_all_connected_cells(client,editor):
    lobby,h=editor
    payload={'waypoints':[[29,12],[35,12]],'allow_bridges':False,'settings':{'scale':1,'color':'#756f61'}}
    preview=client.post(f'/lobbies/{lobby}/world-roads/preview',headers=h,json=payload)
    result=client.post(f'/lobbies/{lobby}/world-roads/build',headers=h,json={**payload,'signature':preview.json['signature']})
    command=result.json['command'];assert len(command['cells'])==7
    assert replay(client,editor,reverse(command)).status_code==200
    assert all(tile(lobby,x,12)['objects']==[] for x in range(29,36))
    assert replay(client,editor,command).status_code==200
    assert 'E' in tile(lobby,31,12)['objects'][0]['connections']


def test_undo_preserves_disjoint_foreign_fields_and_rejects_overlapping_edits(client,editor):
    lobby,h=editor
    result=client.patch(f'/lobbies/{lobby}/chunks/0/0/tile/3/4',headers=h,json={'height':1.75})
    command=result.json['command']
    objects=[{'type':'tree','name':'Foreign'}]
    client.patch(f'/lobbies/{lobby}/chunks/0/0/tile/3/4',headers=h,json={'objects':objects,'radiation':2})
    assert replay(client,editor,reverse(command)).status_code==200
    assert tile(lobby,3,4)['height']==1 and tile(lobby,3,4)['objects']==objects and tile(lobby,3,4)['radiation']==2
    client.patch(f'/lobbies/{lobby}/chunks/0/0/tile/3/4',headers=h,json={'height':1.9})
    assert replay(client,editor,command).status_code==409
    assert tile(lobby,3,4)['height']==1.9


def test_multichunk_conflict_has_no_partial_changes(client,editor):
    lobby,h=editor
    result=client.post(f'/lobbies/{lobby}/chunks/batch',headers=h,json=[{'chunk_x':cx,'chunk_y':0,'tile_x':x,'tile_y':5,'updates':{'terrain':'sand','height':1.2}} for cx,x in [(0,31),(1,0)]])
    command=result.json['command']
    client.patch(f'/lobbies/{lobby}/chunks/1/0/tile/0/5',headers=h,json={'terrain':'rock'})
    assert replay(client,editor,reverse(command)).status_code==409
    assert tile(lobby,31,5)['terrain']=='sand' and tile(lobby,32,5)['terrain']=='rock'


def test_history_permissions_and_duplicate_cells(client,editor,create_user,auth_headers):
    lobby,h=editor
    command=client.patch(f'/lobbies/{lobby}/chunks/0/0/tile/1/1',headers=h,json={'height':1.4}).json['command']
    player=auth_headers(create_user())
    assert client.post(f'/lobbies/{lobby}/world-editor/changes',headers=player,json=reverse(command)).status_code in (403,404)
    command['cells']*=2
    assert replay(client,editor,reverse(command)).status_code==400
    assert tile(lobby,1,1)['height']==1.4
