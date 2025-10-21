"""
Lambda handler for FastAPI application
Adapts API Gateway events to FastAPI using Mangum
"""
from mangum import Mangum
from fastapi_solver_service import app

# Create Lambda handler
handler = Mangum(app, lifespan="off")
