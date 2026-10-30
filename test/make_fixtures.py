"""시험용 DXF 만들기 (ezdxf 1.4.x). 다른 프로그램이 만든 DXF를 우리가 제대로 읽는지 보려는 것.

사용: python -I make_fixtures.py <출력 폴더>
"""
import math
import sys
from pathlib import Path

import ezdxf
from ezdxf.math import Vec3

out = Path(sys.argv[1])
out.mkdir(parents=True, exist_ok=True)


def rich(version, name, encoding=None):
    doc = ezdxf.new(version, setup=True)
    if encoding:
        doc.encoding = encoding
    doc.layers.add('벽체', color=7)
    doc.layers.add('중심선', color=1, linetype='CENTER')
    off = doc.layers.add('숨김층', color=3)
    off.off()
    doc.layers.add('잠금층', color=4).lock()
    msp = doc.modelspace()
    msp.add_line((0, 0), (1000, 0), dxfattribs={'layer': '벽체'})
    msp.add_circle((500, 500), 100, dxfattribs={'layer': '중심선'})
    msp.add_arc((500, 500), 200, 0, 90, dxfattribs={'layer': '중심선', 'color': 5})
    # -Z 방향(대칭한) 호: OCS 중심 (100,0) 은 WCS (-100,0)
    msp.add_arc((100, 0), 50, 0, 90, dxfattribs={'extrusion': (0, 0, -1)})
    msp.add_text('한글 문자 Ø20', dxfattribs={'layer': '벽체', 'height': 50, 'rotation': 30}).set_placement((0, 800))
    msp.add_text('가운데', dxfattribs={'height': 40}).set_placement((800, 800), align=ezdxf.enums.TextEntityAlignment.MIDDLE_CENTER)
    if version != 'R12':
        msp.add_lwpolyline([(0, 0, 0, 0, 0.5), (300, 0), (300, 200), (0, 200)], format='xyseb', close=True)
        msp.add_mtext('{\\fArial|b1;굵은} 첫줄\\P둘째 줄 \\H2x;크게', dxfattribs={'char_height': 30, 'insert': (0, -300), 'attachment_point': 1})
        msp.add_ellipse((1500, 500), major_axis=(300, 0), ratio=0.5, start_param=0, end_param=math.pi)
        msp.add_spline([(0, -600), (200, -500), (400, -700), (600, -600)])
        h = msp.add_hatch(color=2)
        h.paths.add_polyline_path([(0, 0), (100, 0), (100, 100)], is_closed=True)
        dim = msp.add_linear_dim(base=(0, -150), p1=(0, 0), p2=(1000, 0), dimstyle='EZDXF')
        dim.render()
    else:
        msp.add_polyline2d([(0, 0), (300, 0), (300, 200), (0, 200)], close=True)
    blk = doc.blocks.new(name='의자')
    blk.add_lwpolyline([(0, 0), (450, 0), (450, 450), (0, 450)], close=True) if version != 'R12' else blk.add_polyline2d([(0, 0), (450, 0), (450, 450), (0, 450)], close=True)
    blk.add_circle((225, 225), 100, dxfattribs={'color': 0})
    blk.add_attdef('NO', (0, -60), dxfattribs={'height': 40})
    ins = msp.add_blockref('의자', (2000, 0), dxfattribs={'rotation': 90, 'xscale': 2, 'yscale': 2, 'layer': '벽체', 'color': 3})
    ins.add_attrib('NO', '의자1', (2000, -60), dxfattribs={'height': 40})
    doc.saveas(out / name)


def hatches(name):
    doc = ezdxf.new('R2018', setup=True)
    doc.layers.add('해치', color=3)
    msp = doc.modelspace()
    # 1) 폴리선 경계(볼록 구간) + ANSI31 축척 2, 30도
    h = msp.add_hatch(color=1, dxfattribs={'layer': '해치'})
    h.paths.add_polyline_path([(0, 0, 0), (100, 0, 0.5), (100, 60, 0), (0, 60, 0)], is_closed=True)
    h.set_pattern_fill('ANSI31', scale=2, angle=30)
    # 2) 모서리 경계를 시계 방향으로 한 바퀴: 선 + 시계 호 + 선 + 시계 호, 단색 (넓이 6000 + π·30²)
    h = msp.add_hatch(color=2)
    ep = h.paths.add_edge_path()
    ep.add_line((200, 60), (300, 60))
    ep.add_arc((300, 30), 30, -90, 90, ccw=False)
    ep.add_line((300, 0), (200, 0))
    ep.add_arc((200, 30), 30, 90, 270, ccw=False)
    # 3) 단색, 구멍 하나 (바깥 사각형 + 안쪽 원)
    h = msp.add_hatch(color=4)
    h.paths.add_polyline_path([(400, 0), (500, 0), (500, 100), (400, 100)], is_closed=True)
    e2 = h.paths.add_edge_path()
    e2.add_arc((450, 50), 20, 0, 360)
    # 4) 타원 모서리 + 스플라인 모서리
    h = msp.add_hatch(color=5)
    e3 = h.paths.add_edge_path()
    e3.add_ellipse((650, 50), major_axis=(50, 0), ratio=0.5, start_angle=0, end_angle=180, ccw=True)
    e3.add_spline(control_points=[(600, 50), (620, 0), (680, 0), (700, 50)], knot_values=[0, 0, 0, 0, 1, 1, 1, 1], degree=3)
    h.set_pattern_fill('ANSI37', scale=1)
    # 5) -Z 방향(대칭) 해치: OCS (100..150) → WCS (-150..-100)
    h = msp.add_hatch(color=6, dxfattribs={'extrusion': (0, 0, -1)})
    h.paths.add_polyline_path([(100, 0), (150, 0), (150, 40), (100, 40)], is_closed=True)
    h.set_pattern_fill('ANSI31', scale=1)
    doc.saveas(out / name)


rich('R2018', 'rich-r2018-utf8.dxf')
hatches('hatch-r2018.dxf')
rich('R2000', 'rich-r2000-cp949.dxf', encoding='cp949')
rich('R12', 'rich-r12-cp949.dxf', encoding='cp949')
print('ok', sorted(p.name for p in out.glob('*.dxf')))
