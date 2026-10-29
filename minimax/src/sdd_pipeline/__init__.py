"""Specification driven development pipeline.

The package wires four building blocks together:

* :mod:`sdd_pipeline.database` - project records in an OceanBase-derived
  database (embedded seekdb, a real OceanBase tenant or SQLite);
* :mod:`sdd_pipeline.memory` - the PowerContext context substrate;
* :mod:`sdd_pipeline.minimax_client` - the model that performs the change;
* :mod:`sdd_pipeline.runner` - the six phase orchestration.
"""

from __future__ import annotations

__all__ = ["__version__"]

__version__ = "1.0.0"
