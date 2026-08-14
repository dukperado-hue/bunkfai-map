#!/usr/bin/env python3
"""Build contacts.js — static contact dataset for the petition letter.

Data sources:
- AeroThai HQ / area control centres: https://www.aerothai.co.th/th/air-traffic-control
- Airport tower/APP contacts: AIP Thailand GEN 3.3 (aip.caat.or.th)
- Amphoe / police: no complete public dataset exists (DOPA blocks scraping);
  use national hotlines (1567, 191) + per-airport ATC auto-match by proximity.
"""
import json

SRC = '/home/ubuntu/research/atc_contacts.json'
OUT = '/home/ubuntu/bunkfai-map/contacts.js'

d = json.load(open(SRC))
atc = d['atc']
ae = d['aerothai']
hl = d['hotlines']

lines = []
lines.append('// contacts.js — ฐานข้อมูลติดต่อหน่วยงาน (AeroThai / ATC / สายด่วน)')
lines.append('// Sources: aerothai.co.th/th/air-traffic-control, AIP Thailand GEN 3.3 (aip.caat.or.th)')
lines.append('window.CONTACTS = ' + json.dumps({
    'aerothai': {
        'name': ae['hqTh'],
        'address': ae['hqAddress'],
        'tel': ae['hqTel'],
        'fax': ae['hqFax'],
        'web': ae['web'],
    },
    'hotlines': hl,
    'atc': {k: {'unit': v.get('unitTh', v.get('unit', '')), 'address': v['address'], 'tel': v['tel'], 'fax': v.get('fax', ''), 'email': v.get('email', '')} for k, v in atc.items()},
}, ensure_ascii=False, indent=None) + ';')

open(OUT, 'w').write('\n'.join(lines) + '\n')
print(f'wrote {OUT}: {len(atc)} ATC entries')
