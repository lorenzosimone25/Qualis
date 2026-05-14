"""AI-assisted metric research (scaffold).

This package defines JSON contracts and stub implementations for a future
LLM-backed workflow. Endpoints are mounted under ``/research/*``.

**Example — plan**

.. code-block:: json

   {"question": "Compare NY and CT on heart failure mortality"}

**Example — retrieve**

.. code-block:: json

   {
     "trace_id": "…",
     "measure_ids": ["MORT_30_HF"],
     "location_tokens": ["S:NY", "S:CT"],
     "include_national": true
   }

Ollama integration: see :class:`dashboard.research.llm_provider.OllamaLLMProvider`.
"""

from .router import router as research_router

__all__ = ["research_router"]
