import pytest
from app.models import MapChunk


@pytest.fixture
def sculpt_case(client, create_user, auth_headers):
    gm=create_user()
    headers=auth_headers(gm)
    lobby=client.post('/lobbies/',headers=headers,json={'name':'Sculpt','map_type':'empty','chunks_width':2,'chunks_height':1}).get_json()['id']
    assert client.get(f'/lobbies/{lobby}/chunks?min_chunk_x=0&max_chunk_x=1&min_chunk_y=0&max_chunk_y=0',headers=headers).status_code==200
    return lobby,headers,gm


def packet():
    return [dict(chunk_x=x,chunk_y=0,tile_x=31 if x==0 else 0,tile_y=12,expected_height=1,expected_terrain='grass',updates={'height':1.75}) for x in (0,1)]


def height(lobby,x):
    return MapChunk.query.filter_by(lobby_id=lobby,chunk_x=x,chunk_y=0).first().data[12][31 if x==0 else 0]['height']


def test_stroke_undo_redo_across_chunk_boundary(client,sculpt_case):
    lobby,h,_=sculpt_case
    data=packet()
    for before,after in [(1,1.75),(1.75,1),(1,1.75)]:
        for item in data:item.update(expected_height=before,updates={'height':after})
        assert client.post(f'/lobbies/{lobby}/chunks/batch',headers=h,json=data).status_code==200
        assert [height(lobby,x) for x in (0,1)]==[after,after]


def test_stale_height_or_terrain_rejects_complete_stroke(client,sculpt_case):
    lobby,h,_=sculpt_case
    client.patch(f'/lobbies/{lobby}/chunks/1/0/tile/0/12',headers=h,json={'height':1.2})
    assert client.post(f'/lobbies/{lobby}/chunks/batch',headers=h,json=packet()).status_code==409
    assert [height(lobby,x) for x in (0,1)]==[1,1.2]


def test_height_history_preserves_foreign_objects_and_radiation(client,sculpt_case):
    lobby,h,_=sculpt_case
    objects=[{'type':'tree','name':'Keep me'}]
    client.patch(f'/lobbies/{lobby}/chunks/1/0/tile/0/12',headers=h,json={'objects':objects,'radiation':2})
    assert client.post(f'/lobbies/{lobby}/chunks/batch',headers=h,json=packet()).status_code==200
    tile=MapChunk.query.filter_by(lobby_id=lobby,chunk_x=1,chunk_y=0).first().data[12][0]
    assert tile['objects']==objects and tile['radiation']==2


@pytest.mark.parametrize('value',[.49,3.1,'1.5',True,float('inf')])
def test_invalid_guarded_height_is_atomic(client,sculpt_case,value):
    lobby,h,_=sculpt_case
    data=packet();data[1]['updates']['height']=value
    assert client.post(f'/lobbies/{lobby}/chunks/batch',headers=h,json=data).status_code==400
    assert [height(lobby,x) for x in (0,1)]==[1,1]


def test_height_stroke_is_gm_only(client,sculpt_case,create_user,auth_headers):
    lobby,h,_=sculpt_case
    player=auth_headers(create_user())
    assert client.post(f'/lobbies/{lobby}/chunks/batch',headers=player,json=packet()).status_code in (403,404)
