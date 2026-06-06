from unittest.mock import MagicMock, patch, AsyncMock
import pytest

from gemiterm.gemini_client import GeminiClient


class TestGeminiClientContinueChat:
    """Tests for the continue_chat method."""

    @pytest.fixture
    def mock_webapi_client(self):
        with patch("gemiterm.gemini_client.WebAPIClient") as mock_client_class:
            mock_client = MagicMock()
            mock_client.init = AsyncMock()
            mock_client.read_chat = AsyncMock()
            mock_client.fetch_latest_chat_response = AsyncMock()
            mock_client.start_chat = MagicMock()
            mock_client.list_chats = MagicMock()
            mock_client_class.return_value = mock_client
            yield mock_client

    def _create_client_with_mock_loop(self, mock_webapi_client, loop_mock):
        client = GeminiClient("test_1psid", "test_1psidts")
        client._client = mock_webapi_client
        client._loop = loop_mock
        return client

    def test_continue_chat_uses_existing_session(self, mock_webapi_client):
        """When conversation_id is already cached, use the existing session."""
        loop_mock = MagicMock()
        client = self._create_client_with_mock_loop(mock_webapi_client, loop_mock)

        cached_chat = MagicMock()
        cached_chat.send_message = AsyncMock()
        cached_chat.send_message.return_value = MagicMock(text="cached response")
        client._chat_sessions["c_existing"] = cached_chat

        result = client.continue_chat("c_existing", "hello")

        assert result == "cached response"
        mock_webapi_client.start_chat.assert_not_called()
        mock_webapi_client.fetch_latest_chat_response.assert_not_called()

    def test_continue_chat_fetch_latest_with_metadata(self, mock_webapi_client):
        """When fetch_latest returns metadata with rid/rcid, create session with full metadata."""
        loop_mock = MagicMock()
        client = self._create_client_with_mock_loop(mock_webapi_client, loop_mock)

        latest_response = MagicMock()
        latest_response.metadata = ["c_abc123", "r_replyid", "rc_candidate123"]
        latest_response.rcid = "rc_candidate123"

        mock_chat = MagicMock()
        mock_chat.metadata = ["c_abc123", "r_replyid", "rc_candidate123"]
        mock_chat.send_message = AsyncMock()
        mock_chat.send_message.return_value = MagicMock(text="continuation response")
        mock_webapi_client.start_chat.return_value = mock_chat

        mock_webapi_client.fetch_latest_chat_response.return_value = latest_response

        result = client.continue_chat("c_abc123", "continue this")

        mock_webapi_client.fetch_latest_chat_response.assert_called_once_with("c_abc123")
        mock_webapi_client.start_chat.assert_called_once_with(
            metadata=["c_abc123", "r_replyid", "rc_candidate123"],
            cid="c_abc123",
            rid="r_replyid",
            rcid="rc_candidate123",
        )
        assert result == "continuation response"
        assert "c_abc123" in client._chat_sessions

    def test_continue_chat_fetch_latest_returns_none(self, mock_webapi_client):
        """When fetch_latest returns None, fall back to cid-only session."""
        loop_mock = MagicMock()
        client = self._create_client_with_mock_loop(mock_webapi_client, loop_mock)

        mock_chat = MagicMock()
        mock_chat.metadata = ["c_abc123", "", "", None, None, None, None, None, None, ""]
        mock_chat.send_message = AsyncMock()
        mock_chat.send_message.return_value = MagicMock(text="fallback response")
        mock_webapi_client.start_chat.return_value = mock_chat

        mock_webapi_client.fetch_latest_chat_response.return_value = None

        result = client.continue_chat("c_abc123", "hello")

        mock_webapi_client.fetch_latest_chat_response.assert_called_once_with("c_abc123")
        mock_webapi_client.start_chat.assert_called_once_with(cid="c_abc123")
        assert result == "fallback response"

    def test_continue_chat_metadata_without_rid(self, mock_webapi_client):
        """When metadata exists but has no rid/rcid, pass empty strings."""
        loop_mock = MagicMock()
        client = self._create_client_with_mock_loop(mock_webapi_client, loop_mock)

        latest_response = MagicMock()
        latest_response.metadata = ["c_abc123", "r_someid"]
        latest_response.rcid = ""

        mock_chat = MagicMock()
        mock_chat.metadata = ["c_abc123", "r_someid", "", None, None, None, None, None, None, ""]
        mock_chat.send_message = AsyncMock()
        mock_chat.send_message.return_value = MagicMock(text="response")
        mock_webapi_client.start_chat.return_value = mock_chat

        mock_webapi_client.fetch_latest_chat_response.return_value = latest_response

        result = client.continue_chat("c_abc123", "test")

        mock_webapi_client.start_chat.assert_called_once_with(
            metadata=["c_abc123", "r_someid"], cid="c_abc123", rid="r_someid", rcid=""
        )
        assert result == "response"

    def test_continue_chat_calls_send_message(self, mock_webapi_client):
        """Verify that send_message is called with the correct message."""
        loop_mock = MagicMock()
        client = self._create_client_with_mock_loop(mock_webapi_client, loop_mock)

        mock_chat = MagicMock()
        mock_chat.send_message = AsyncMock()
        mock_chat.send_message.return_value = MagicMock(text="sent response")
        mock_webapi_client.start_chat.return_value = mock_chat

        mock_webapi_client.fetch_latest_chat_response.return_value = None

        result = client.continue_chat("c_abc", "my message")

        mock_chat.send_message.assert_called_once_with("my message")
        assert result == "sent response"

    def test_continue_chat_caches_new_session(self, mock_webapi_client):
        """New session should be stored in _chat_sessions for reuse."""
        loop_mock = MagicMock()
        client = self._create_client_with_mock_loop(mock_webapi_client, loop_mock)

        mock_chat = MagicMock()
        mock_chat.send_message = AsyncMock()
        mock_chat.send_message.return_value = MagicMock(text="first")
        mock_webapi_client.start_chat.return_value = mock_chat

        mock_webapi_client.fetch_latest_chat_response.return_value = None

        assert "c_new" not in client._chat_sessions

        client.continue_chat("c_new", "hello")

        assert "c_new" in client._chat_sessions
        assert client._chat_sessions["c_new"] is mock_chat


class TestGeminiClientListChats:
    """Tests for list_chats method."""

    @pytest.fixture
    def mock_webapi_client(self):
        with patch("gemiterm.gemini_client.WebAPIClient") as mock_client_class:
            mock_client = MagicMock()
            mock_client.init = AsyncMock()
            mock_client.list_chats = MagicMock()
            mock_client_class.return_value = mock_client
            yield mock_client

    def _create_client_with_mock_loop(self, mock_webapi_client, loop_mock):
        client = GeminiClient("test_1psid", "test_1psidts")
        client._client = mock_webapi_client
        client._loop = loop_mock
        return client

    def test_list_chats_returns_formatted_list(self, mock_webapi_client):
        """list_chats should return a list of dicts with id, title, is_pinned, timestamp."""
        loop_mock = MagicMock()
        client = self._create_client_with_mock_loop(mock_webapi_client, loop_mock)

        mock_chat1 = MagicMock()
        mock_chat1.cid = "c_1"
        mock_chat1.title = "Chat One"
        mock_chat1.is_pinned = True
        mock_chat1.timestamp = 1234567890

        mock_chat2 = MagicMock()
        mock_chat2.cid = "c_2"
        mock_chat2.title = "Chat Two"
        mock_chat2.is_pinned = False
        mock_chat2.timestamp = 9876543210

        mock_webapi_client.list_chats.return_value = [mock_chat1, mock_chat2]

        result = client.list_chats()

        assert len(result) == 2
        assert result[0]["id"] == "c_1"
        assert result[0]["title"] == "Chat One"
        assert result[0]["is_pinned"] is True
        assert result[1]["id"] == "c_2"

    def test_list_chats_returns_empty_list_when_none(self, mock_webapi_client):
        """list_chats should return [] when list_chats returns None."""
        loop_mock = MagicMock()
        client = self._create_client_with_mock_loop(mock_webapi_client, loop_mock)
        mock_webapi_client.list_chats.return_value = None

        result = client.list_chats()

        assert result == []


class TestGeminiClientFetchChat:
    """Tests for fetch_chat method."""

    @pytest.fixture
    def mock_webapi_client(self):
        with patch("gemiterm.gemini_client.WebAPIClient") as mock_client_class:
            mock_client = MagicMock()
            mock_client.init = AsyncMock()
            mock_client.read_chat = AsyncMock()
            mock_client_class.return_value = mock_client
            yield mock_client

    def _create_client_with_mock_loop(self, mock_webapi_client, loop_mock):
        client = GeminiClient("test_1psid", "test_1psidts")
        client._client = mock_webapi_client
        client._loop = loop_mock
        return client

    def test_fetch_chat_returns_parsed_messages(self, mock_webapi_client):
        """fetch_chat should parse history into list of message dicts."""
        loop_mock = MagicMock()
        client = self._create_client_with_mock_loop(mock_webapi_client, loop_mock)

        mock_history = MagicMock()
        mock_turn1 = MagicMock()
        mock_turn1.role = "user"
        mock_turn1.text = "Hello"
        mock_turn2 = MagicMock()
        mock_turn2.role = "model"
        mock_turn2.text = "Hi there"
        mock_history.turns = [mock_turn1, mock_turn2]

        mock_webapi_client.read_chat.return_value = mock_history

        result = client.fetch_chat("c_abc")

        assert len(result) == 2
        assert result[0]["role"] == "user"
        assert result[0]["content"] == "Hello"
        assert result[0]["conversation_id"] == "c_abc"
        assert result[1]["role"] == "model"
        assert result[1]["content"] == "Hi there"

    def test_fetch_chat_returns_none_when_history_none(self, mock_webapi_client):
        """fetch_chat should return None when read_chat returns None."""
        loop_mock = MagicMock()
        client = self._create_client_with_mock_loop(mock_webapi_client, loop_mock)
        mock_webapi_client.read_chat.return_value = None

        result = client.fetch_chat("c_abc")

        assert result is None


class TestGeminiClientStartNewChat:
    """Tests for the start_new_chat method."""

    @pytest.fixture
    def mock_webapi_client(self):
        with patch("gemiterm.gemini_client.WebAPIClient") as mock_client_class:
            mock_client = MagicMock()
            mock_client.init = AsyncMock()
            mock_client.start_chat = MagicMock()
            mock_client_class.return_value = mock_client
            yield mock_client

    def _create_client_with_mock_loop(self, mock_webapi_client, loop_mock):
        client = GeminiClient("test_1psid", "test_1psidts")
        client._client = mock_webapi_client
        client._loop = loop_mock
        return client

    def test_start_new_chat_creates_new_conversation(self, mock_webapi_client):
        """start_new_chat should create a new chat without cid and send first message."""
        loop_mock = MagicMock()
        client = self._create_client_with_mock_loop(mock_webapi_client, loop_mock)

        mock_chat = MagicMock()
        mock_chat.send_message = AsyncMock()
        mock_chat.send_message.return_value = MagicMock(text="Hello from Gemini")
        mock_chat.cid = "c_new_abc123"
        mock_webapi_client.start_chat.return_value = mock_chat

        result_text, result_cid = client.start_new_chat("Hello")

        mock_webapi_client.start_chat.assert_called_once_with()
        mock_chat.send_message.assert_called_once_with("Hello")
        assert result_text == "Hello from Gemini"
        assert result_cid == "c_new_abc123"

    def test_start_new_chat_returns_text_and_cid(self, mock_webapi_client):
        """start_new_chat should return tuple of (response_text, conversation_id)."""
        loop_mock = MagicMock()
        client = self._create_client_with_mock_loop(mock_webapi_client, loop_mock)

        mock_chat = MagicMock()
        mock_chat.send_message = AsyncMock()
        mock_chat.send_message.return_value = MagicMock(text="Response text")
        mock_chat.cid = "c_new_xyz789"
        mock_webapi_client.start_chat.return_value = mock_chat

        result = client.start_new_chat("Initial message")

        assert isinstance(result, tuple)
        assert len(result) == 2
        text, cid = result
        assert text == "Response text"
        assert cid == "c_new_xyz789"

    def test_start_new_chat_api_error(self, mock_webapi_client):
        """start_new_chat should raise GeminiAPIError on API failure."""
        loop_mock = MagicMock()
        client = self._create_client_with_mock_loop(mock_webapi_client, loop_mock)

        mock_chat = MagicMock()
        mock_chat.send_message = AsyncMock(side_effect=Exception("API error"))
        mock_webapi_client.start_chat.return_value = mock_chat

        from gemiterm.exceptions import GeminiAPIError

        with pytest.raises(GeminiAPIError):
            client.start_new_chat("Hello")
