"""Tests for CLI command: new."""
import pytest
from unittest.mock import patch, MagicMock, AsyncMock
from click.testing import CliRunner

from gemiterm.cli import cli


class TestNew:
    def test_new_with_message_calls_start_new_chat(self, active_profiles):
        with (
            patch("gemiterm.cli.list_profile_statuses", return_value=active_profiles),
            patch("gemiterm.cli.load_cookies") as mock_cookies,
            patch("gemiterm.cli.GeminiClient") as mock_client_class,
        ):
            mock_cookies.return_value = ("sid123", "ts123")
            mock_client = MagicMock()
            mock_response = MagicMock()
            mock_response.text = "AI response here"
            mock_client.start_new_chat.return_value = ("AI response here", "c_new_abc123")
            mock_client_class.return_value = mock_client
            runner = CliRunner()
            result = runner.invoke(cli, ["new", "Hello AI"])
            assert result.exit_code == 0
            assert "Response:" in result.output
            assert "AI response here" in result.output
            assert "New conversation ID:" in result.output
            assert "c_new_abc123" in result.output
            mock_client.start_new_chat.assert_called_once_with("Hello AI")

    def test_new_with_no_message_starts_interactive(self, active_profiles):
        with (
            patch("gemiterm.cli.list_profile_statuses", return_value=active_profiles),
            patch("gemiterm.cli.load_cookies") as mock_cookies,
            patch("gemiterm.cli.GeminiClient") as mock_client_class,
        ):
            mock_cookies.return_value = ("sid123", "ts123")
            mock_client = MagicMock()
            mock_client_class.return_value = mock_client
            runner = CliRunner()
            result = runner.invoke(cli, ["new"])
            assert result.exit_code == 0
            assert "New conversation started" in result.output
            assert "Type your message" in result.output

    def test_new_with_profile_option(self, active_profiles):
        with (
            patch("gemiterm.cli.list_profile_statuses", return_value=active_profiles),
            patch("gemiterm.cli.load_cookies") as mock_cookies,
            patch("gemiterm.cli.GeminiClient") as mock_client_class,
        ):
            mock_cookies.return_value = ("sid123", "ts123")
            mock_client = MagicMock()
            mock_response = MagicMock()
            mock_response.text = "Response"
            mock_client.start_new_chat.return_value = ("Response", "c_new_xyz")
            mock_client_class.return_value = mock_client
            runner = CliRunner()
            result = runner.invoke(cli, ["new", "-p", "default", "Hello"])
            assert result.exit_code == 0
            mock_cookies.assert_called_with("default")

    def test_new_no_active_profiles(self):
        with patch("gemiterm.cli.list_profile_statuses", return_value=[]):
            runner = CliRunner()
            result = runner.invoke(cli, ["new", "Hello"])
            assert result.exit_code == 2
            assert "No active profiles found" in result.output

    def test_new_invalid_profile(self, active_profiles):
        with (
            patch("gemiterm.cli.list_profile_statuses", return_value=active_profiles),
        ):
            runner = CliRunner()
            result = runner.invoke(cli, ["new", "-p", "nonexistent", "Hello"])
            assert result.exit_code == 1
            assert "not active" in result.output

    def test_new_api_error(self, active_profiles):
        with (
            patch("gemiterm.cli.list_profile_statuses", return_value=active_profiles),
            patch("gemiterm.cli.load_cookies") as mock_cookies,
            patch("gemiterm.cli.GeminiClient") as mock_client_class,
        ):
            mock_cookies.return_value = ("sid123", "ts123")
            mock_client = MagicMock()
            from gemiterm.exceptions import GeminiAPIError

            mock_client.start_new_chat.side_effect = GeminiAPIError("API error")
            mock_client_class.return_value = mock_client
            runner = CliRunner()
            result = runner.invoke(cli, ["new", "Hello"])
            assert result.exit_code == 1
            assert "API error" in result.output

    def test_new_authentication_error(self, active_profiles):
        with (
            patch("gemiterm.cli.list_profile_statuses", return_value=active_profiles),
            patch("gemiterm.cli.load_cookies") as mock_cookies,
            patch("gemiterm.cli.GeminiClient") as mock_client_class,
        ):
            mock_cookies.return_value = ("sid123", "ts123")
            mock_client = MagicMock()
            from gemiterm.exceptions import AuthenticationError

            mock_client.start_new_chat.side_effect = AuthenticationError("Auth failed")
            mock_client_class.return_value = mock_client
            runner = CliRunner()
            result = runner.invoke(cli, ["new", "Hello"])
            assert result.exit_code == 2
            assert "Auth failed" in result.output

    def test_new_cookie_expired_error(self, active_profiles):
        with (
            patch("gemiterm.cli.list_profile_statuses", return_value=active_profiles),
            patch("gemiterm.cli.load_cookies") as mock_cookies,
            patch("gemiterm.cli.GeminiClient") as mock_client_class,
        ):
            mock_cookies.return_value = ("sid123", "ts123")
            mock_client = MagicMock()
            from gemiterm.exceptions import CookieExpiredError

            mock_client.start_new_chat.side_effect = CookieExpiredError("Session expired")
            mock_client_class.return_value = mock_client
            runner = CliRunner()
            result = runner.invoke(cli, ["new", "Hello"])
            assert result.exit_code == 2
            assert "Session expired" in result.output