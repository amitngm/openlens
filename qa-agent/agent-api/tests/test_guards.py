"""Tests for security guards."""

import pytest
from app.utils.guards import (
    check_env_guard,
    check_test_account_guard,
    GuardError,
)


class TestEnvGuard:
    """Tests for ENV_GUARD."""
    
    def test_allows_dev_environment(self):
        """Should allow dev environment."""
        # Should not raise
        check_env_guard("dev", "test-flow")
    
    def test_allows_staging_environment(self):
        """Should allow staging environment."""
        check_env_guard("staging", "test-flow")
    
    def test_blocks_production(self):
        """Should block production environment."""
        with pytest.raises(GuardError) as exc_info:
            check_env_guard("production", "test-flow")
        
        assert "not allowed in production" in str(exc_info.value)
    
    def test_blocks_prod_shorthand(self):
        """Should block 'prod' shorthand."""
        with pytest.raises(GuardError):
            check_env_guard("prod", "test-flow")
    
    def test_blocks_prd_shorthand(self):
        """Should block 'prd' shorthand."""
        with pytest.raises(GuardError):
            check_env_guard("prd", "test-flow")
    
    def test_force_allow_production(self):
        """Should allow production with force flag."""
        # Should not raise
        check_env_guard("production", "test-flow", force_allow=True)


class TestTestAccountGuard:
    """Tests for TEST_ACCOUNT_GUARD."""
    
    def test_allows_with_test_tenant_true(self):
        """Should allow when testTenant=true."""
        variables = {"testTenant": True}
        # Should not raise
        check_test_account_guard(variables)
    
    def test_blocks_without_test_tenant(self):
        """Should block when testTenant is missing."""
        variables = {}
        with pytest.raises(GuardError) as exc_info:
            check_test_account_guard(variables)
        
        assert "testTenant=true" in str(exc_info.value)
    
    def test_blocks_with_test_tenant_false(self):
        """Should block when testTenant=false."""
        variables = {"testTenant": False}
        with pytest.raises(GuardError):
            check_test_account_guard(variables)
