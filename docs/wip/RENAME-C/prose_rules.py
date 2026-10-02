#!/usr/bin/env python3
"""Mechanical prose rules (unambiguous phrases only). usage: prose_rules.py DOC..."""
import re, sys
R = [
 (r'Flight Data Record \(FDR\)', 'Flight data'),
 (r'\bFlight Data Records\b', 'flight data'),
 (r'\bFlight Data Record\b', 'flight data'),
 (r'\bFDRs\b', 'flight data'),
 (r'\bFDR\b', 'flight data'),
 (r'Strip Roles\b', 'strip types'),
 (r'Strip Role\b', 'strip type'),
 (r'strip Roles\b', 'strip types'),
 (r'\bField State\b', 'Runway Status'),
 (r'\bField state\b', 'Runway status'),
 (r'\bfield state\b', 'runway status'),
 (r'\bfield-state\b', 'runway-status'),
 (r'\brelease states\b', 'departure release states'),
 (r'\brelease state\b', 'departure release state'),
 (r'\bSTCAs?\b', 'Conflict Alert'),
 (r'\bTWR\b', 'LC'),
 (r'\bGND\b', 'GC'),
 (r'\bAPP\b', 'AP'),
]
for doc in sys.argv[1:]:
    s = open(doc).read(); c = 0
    for a, b in R:
        s, k = re.subn(a, b, s); c += k
    open(doc, 'w').write(s); print(doc, c)
