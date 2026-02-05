"""Port-forward manager for kubectl port-forward sessions."""

import asyncio
import logging
import subprocess
import socket
from typing import Dict, Optional, List
from pathlib import Path

logger = logging.getLogger(__name__)


class PortForwardManager:
    """Manage kubectl port-forward sessions for database connections."""

    def __init__(self, port_range_start: int = 30000, port_range_end: int = 40000):
        """
        Initialize PortForwardManager.

        Args:
            port_range_start: Start of local port range
            port_range_end: End of local port range
        """
        self.active_forwards: Dict[int, subprocess.Popen] = {}  # local_port -> process
        self.port_range = range(port_range_start, port_range_end)
        self.used_ports = set()

    def _find_available_port(self) -> Optional[int]:
        """
        Find an available local port.

        Returns:
            Available port number or None if none available
        """
        for port in self.port_range:
            if port in self.used_ports:
                continue

            # Check if port is actually available
            try:
                with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
                    s.bind(("127.0.0.1", port))
                    return port
            except OSError:
                continue

        return None

    async def start_port_forward(
        self,
        service_name: str,
        namespace: str,
        remote_port: int,
        kubeconfig_path: Optional[str] = None
    ) -> Optional[int]:
        """
        Start kubectl port-forward and return local port.

        Args:
            service_name: K8s service name
            namespace: K8s namespace
            remote_port: Remote port on the service
            kubeconfig_path: Optional path to kubeconfig file

        Returns:
            Local port number if successful, None otherwise
        """
        # Find available local port
        local_port = self._find_available_port()
        if not local_port:
            logger.error("No available ports for port-forward")
            return None

        # Build kubectl command
        cmd = [
            "kubectl",
            "port-forward",
            "-n", namespace,
            f"svc/{service_name}",
            f"{local_port}:{remote_port}"
        ]

        # Add kubeconfig if specified
        if kubeconfig_path:
            cmd.insert(1, "--kubeconfig")
            cmd.insert(2, kubeconfig_path)

        try:
            logger.info(f"Starting port-forward: {service_name}:{remote_port} -> localhost:{local_port}")

            # Start port-forward process
            process = subprocess.Popen(
                cmd,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True
            )

            # Give it a moment to establish
            await asyncio.sleep(2)

            # Check if process is still running
            if process.poll() is not None:
                # Process terminated
                stdout, stderr = process.communicate()
                logger.error(f"Port-forward failed to start: {stderr}")
                return None

            # Success
            self.active_forwards[local_port] = process
            self.used_ports.add(local_port)

            logger.info(f"Port-forward established: localhost:{local_port} -> {service_name}:{remote_port}")
            return local_port

        except FileNotFoundError:
            logger.error("kubectl command not found. Is kubectl installed?")
            return None
        except Exception as e:
            logger.error(f"Error starting port-forward: {e}")
            return None

    async def stop_port_forward(self, local_port: int) -> bool:
        """
        Stop port-forward process.

        Args:
            local_port: Local port of the port-forward to stop

        Returns:
            True if stopped successfully, False otherwise
        """
        process = self.active_forwards.get(local_port)
        if not process:
            logger.warning(f"No active port-forward on port {local_port}")
            return False

        try:
            logger.info(f"Stopping port-forward on localhost:{local_port}")

            # Terminate the process
            process.terminate()

            # Wait for it to exit (with timeout)
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                # Force kill if it doesn't terminate
                logger.warning(f"Port-forward on {local_port} did not terminate, killing...")
                process.kill()
                process.wait()

            # Clean up
            del self.active_forwards[local_port]
            self.used_ports.discard(local_port)

            logger.info(f"Port-forward on localhost:{local_port} stopped")
            return True

        except Exception as e:
            logger.error(f"Error stopping port-forward: {e}")
            return False

    def get_active_forwards(self) -> List[Dict]:
        """
        Get list of active port-forwards.

        Returns:
            List of active port-forward info
        """
        active = []
        for local_port, process in list(self.active_forwards.items()):
            # Check if process is still alive
            if process.poll() is not None:
                # Process died, clean up
                logger.warning(f"Port-forward on {local_port} died unexpectedly")
                del self.active_forwards[local_port]
                self.used_ports.discard(local_port)
                continue

            active.append({
                "local_port": local_port,
                "pid": process.pid,
                "status": "active"
            })

        return active

    def is_port_forward_active(self, local_port: int) -> bool:
        """
        Check if port-forward is active on given port.

        Args:
            local_port: Local port to check

        Returns:
            True if active, False otherwise
        """
        process = self.active_forwards.get(local_port)
        if not process:
            return False

        # Check if process is still running
        if process.poll() is not None:
            # Process died
            del self.active_forwards[local_port]
            self.used_ports.discard(local_port)
            return False

        return True

    async def cleanup_all(self):
        """Stop all active port-forwards."""
        logger.info(f"Cleaning up {len(self.active_forwards)} active port-forwards")

        for local_port in list(self.active_forwards.keys()):
            await self.stop_port_forward(local_port)

        logger.info("All port-forwards cleaned up")

    async def health_check(self):
        """Check health of all active port-forwards and clean up dead ones."""
        dead_ports = []

        for local_port, process in self.active_forwards.items():
            if process.poll() is not None:
                logger.warning(f"Port-forward on {local_port} is dead")
                dead_ports.append(local_port)

        # Clean up dead forwards
        for local_port in dead_ports:
            del self.active_forwards[local_port]
            self.used_ports.discard(local_port)

        if dead_ports:
            logger.info(f"Cleaned up {len(dead_ports)} dead port-forwards")


# Global instance
_port_forward_manager = None


def get_port_forward_manager() -> PortForwardManager:
    """Get global PortForwardManager instance."""
    global _port_forward_manager
    if _port_forward_manager is None:
        _port_forward_manager = PortForwardManager()
    return _port_forward_manager
