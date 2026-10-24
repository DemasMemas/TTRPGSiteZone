import copy

import pytest

from app.extensions import db
from app.models import MapChunk


@pytest.fixture
def road_case(client, create_user, auth_headers):
    gm=create_user(); headers=auth_headers(gm)
    lobby=client.post('/lobbies/',headers=headers,json={'name':'Road test','map_type':'empty','chunks_width':2,'chunks_height':1}).get_json()['id']
    client.get(f'/lobbies/{lobby}/chunks?min_chunk_x=0&max_chunk_x=1&min_chunk_y=0&max_chunk_y=0',headers=headers)
    return lobby,headers


def call(client,case,action,data):
    lobby,headers=case
    return client.post(f'/lobbies/{lobby}/world-roads/{action}',headers=headers,json=data)


def payload(points,bridges=False):
    return {'waypoints':points,'allow_bridges':bridges,'settings':{'scale':1,'color':'#756f61'}}


def river(case):
    chunk=MapChunk.query.filter_by(lobby_id=case[0],chunk_x=0,chunk_y=0).first()
    data=copy.deepcopy(chunk.data)
    for row in data:row[31].update(terrain='water',height=.4)
    chunk.data=data;db.session.commit()


def test_preview_readonly_and_cross_chunk_build(client,road_case):
    chunks=MapChunk.query.filter_by(lobby_id=road_case[0]).all()
    before=[copy.deepcopy(c.data) for c in chunks]
    data=payload([[29,12],[35,12]])
    preview=call(client,road_case,'preview',data)
    assert preview.status_code==200
    assert [c.data for c in chunks]==before
    result=call(client,road_case,'build',{**data,'signature':preview.json['signature']})
    assert result.status_code==200
    assert len(result.json['updates'])==7
    a=MapChunk.query.filter_by(lobby_id=road_case[0],chunk_x=0,chunk_y=0).first().data[12][31]['objects'][0]
    b=MapChunk.query.filter_by(lobby_id=road_case[0],chunk_x=1,chunk_y=0).first().data[12][0]['objects'][0]
    assert 'E' in a['connections'] and 'W' in b['connections']
    assert a['authored_route'] and b['authored_route']


def test_preview_unstored_chunks_does_not_persist_generated_world(client,road_case):
    MapChunk.query.filter_by(lobby_id=road_case[0]).delete();db.session.commit()
    response=call(client,road_case,'preview',payload([[29,12],[35,12]]))
    assert response.status_code==200
    assert MapChunk.query.filter_by(lobby_id=road_case[0]).count()==0


def test_bridges_opt_in_and_deck_height(client,road_case):
    river(road_case)
    data=payload([[29,12],[35,12]])
    assert call(client,road_case,'preview',data).status_code==400
    data['allow_bridges']=True
    plan=call(client,road_case,'preview',data).json
    assert plan['bridges']==1
    bridge=next(p for p in plan['path'] if p['bridge'])
    assert bridge['bridge_height']==pytest.approx(1.06)
    assert call(client,road_case,'build',{**data,'signature':plan['signature']}).status_code==200
    tile=MapChunk.query.filter_by(lobby_id=road_case[0],chunk_x=0).first().data[12][31]
    assert tile['terrain']=='water' and tile['objects'][0]['bridge']
    assert call(client,road_case,'preview',payload([[29,12],[35,12]])).status_code==400


def test_stale_preview_rejects_whole_route(client,road_case):
    data=payload([[29,12],[35,12]])
    plan=call(client,road_case,'preview',data).json
    client.patch(f'/lobbies/{road_case[0]}/chunks/1/0/tile/0/12',headers=road_case[1],json={'objects':[{'type':'tree','name':'keep'}]})
    assert call(client,road_case,'build',{**data,'signature':plan['signature']}).status_code==409
    assert MapChunk.query.filter_by(lobby_id=road_case[0],chunk_x=0).first().data[12][31]['objects']==[]


def test_waypoints_reuse_preserve_other_objects_and_settings(client,road_case):
    lobby,headers=road_case
    road={'type':'road','scale':1.3,'color':'#123456','connections':['N','S'],'note':'old'}
    client.patch(f'/lobbies/{lobby}/chunks/0/0/tile/30/13',headers=headers,json={'objects':[{'type':'tree'},road]})
    data=payload([[29,12],[30,13],[35,12]])
    plan=call(client,road_case,'preview',data).json
    assert any(p['x']==30 and p['y']==13 for p in plan['path']) and plan['reused']>=1
    assert call(client,road_case,'build',{**data,'signature':plan['signature']}).status_code==200
    tile=MapChunk.query.filter_by(lobby_id=lobby,chunk_x=0).first().data[13][30]
    assert tile['objects'][0]['type']=='tree'
    assert tile['objects'][1]['color']=='#123456' and tile['objects'][1]['connections']==['N','S']
    assert tile['objects'][1]['manual_connections']


def test_dry_detour_and_existing_road_preference(client,road_case):
    chunk=MapChunk.query.filter_by(lobby_id=road_case[0],chunk_x=0).first()
    data=copy.deepcopy(chunk.data)
    for y in range(9,14):data[y][31]['terrain']='water'
    for x in range(25,32):data[14][x]['objects']=[{'type':'road'}]
    chunk.data=data;db.session.commit()
    plan=call(client,road_case,'preview',payload([[25,12],[35,12]])).json
    assert not any(p['bridge'] for p in plan['path'])
    assert plan['reused']>0


def test_diagonal_is_shortest_and_saves_reciprocal_edges_across_chunks(client,road_case):
    data=payload([[29,10],[35,16]])
    plan=call(client,road_case,'preview',data).json
    assert [(p['x'],p['y']) for p in plan['path']]==[(29+i,10+i) for i in range(7)]
    assert call(client,road_case,'build',{**data,'signature':plan['signature']}).status_code==200
    a=MapChunk.query.filter_by(lobby_id=road_case[0],chunk_x=0).first().data[12][31]['objects'][0]
    b=MapChunk.query.filter_by(lobby_id=road_case[0],chunk_x=1).first().data[13][0]['objects'][0]
    assert 'SE' in a['manual_connections'] and 'NW' in b['manual_connections']


def test_existing_long_detour_does_not_replace_short_diagonal(client,road_case):
    chunk=MapChunk.query.filter_by(lobby_id=road_case[0],chunk_x=0).first();data=copy.deepcopy(chunk.data)
    for x in range(10,21):data[10][x]['objects']=[{'type':'road'}]
    for y in range(11,21):data[y][20]['objects']=[{'type':'road'}]
    chunk.data=data;db.session.commit()
    plan=call(client,road_case,'preview',payload([[10,10],[20,20]])).json
    assert len(plan['path'])==11


def test_diagonal_cannot_cut_a_water_corner(client,road_case):
    client.patch(f'/lobbies/{road_case[0]}/chunks/0/0/tile/11/10',headers=road_case[1],json={'terrain':'water'})
    plan=call(client,road_case,'preview',payload([[10,10],[11,11]])).json
    assert [(p['x'],p['y']) for p in plan['path']]==[(10,10),(10,11),(11,11)]


def test_diagonal_side_cells_are_guarded_but_not_painted(client,road_case):
    data=payload([[29,10],[35,16]])
    plan=call(client,road_case,'preview',data).json
    client.patch(f'/lobbies/{road_case[0]}/chunks/0/0/tile/30/10',headers=road_case[1],json={'height':1.1})
    assert call(client,road_case,'build',{**data,'signature':plan['signature']}).status_code==409
    plan=call(client,road_case,'preview',data).json
    assert call(client,road_case,'build',{**data,'signature':plan['signature']}).status_code==200
    tile=MapChunk.query.filter_by(lobby_id=road_case[0],chunk_x=0).first().data[10][30]
    assert tile['objects']==[]


@pytest.mark.parametrize('data',[payload([[0,0],[64,1]]),payload([[0,0],[True,1]]),payload([[1,1],[1,1]]),{'waypoints':[]},None])
def test_invalid_requests(client,road_case,data):
    assert call(client,road_case,'preview',data).status_code==400


def test_non_gm(client,road_case,create_user,auth_headers):
    response=client.post(f'/lobbies/{road_case[0]}/world-roads/preview',headers=auth_headers(create_user()),json=payload([[1,1],[3,3]]))
    assert response.status_code in (403,404)
