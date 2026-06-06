import asyncio
import json
import os
import shutil
import subprocess
import sys
from datetime import datetime
from pathlib import Path
from typing import Any

import click
from rich.console import Console
from rich.progress import Progress, SpinnerColumn, TextColumn, BarColumn, TaskProgressColumn
from rich.table import Table

from gemiterm import __version__
from gemiterm.auth_manager import (
    delete_profile,
    get_default_profile_name,
    list_profile_statuses,
    list_profiles,
    load_cookies,
    login,
    rename_profile,
)
from gemiterm.config import set_default_profile_name
from gemiterm.error_handlers import (
    handle_cli_error,
    input_with_exit,
    prompt_with_exit,
    require_active_profiles,
)
from gemiterm.exceptions import (
    AuthenticationError,
    CookieExpiredError,
    ConversationNotFoundError,
    GeminiAPIError,
)
from gemiterm.exporter import format_chat_as_markdown
from gemiterm.gemini_client import GeminiClient
from gemiterm.logging_config import setup_logging
from gemiterm.validators import parse_iso_date, validate_conversation_id

_list = list
console = Console()


def _render_profiles_table(statuses: list[dict], show_ids: bool = False) -> Table:
    table = Table(title="Authentication Profiles")
    if show_ids:
        table.add_column("ID", style="cyan")
    table.add_column("Name", style="cyan")
    table.add_column("Status", style="yellow")
    table.add_column("Expires", style="blue")
    table.add_column("Default", style="green")

    for idx, status in enumerate(statuses, start=1):
        name = status["name"]
        if status["is_active"]:
            status_str = "Active"
        elif status["exists"]:
            status_str = "Refresh needed"
        else:
            status_str = "Expired"
        expires = status.get("expires_at") or "N/A"
        default_marker = "*" if status.get("is_default") else ""
        if show_ids:
            table.add_row(str(idx), name, status_str, expires, default_marker)
        else:
            table.add_row(name, status_str, expires, default_marker)
    return table


def _collect_chats_all_profiles() -> list[dict[str, Any]]:
    statuses = list_profile_statuses()
    active = [s for s in statuses if s["is_active"]]
    if not active:
        console.print("[bold red]No active profiles found.[/bold red]")
        console.print("[yellow]Run 'gemiterm auth' to authenticate.[/yellow]")
        sys.exit(2)

    all_chats: dict[str, dict[str, Any]] = {}
    for profile_status in active:
        pname = profile_status["name"]
        try:
            secure_1psid, secure_1psidts = load_cookies(pname)
            client = GeminiClient(secure_1psid, secure_1psidts)
            profile_chats = client.list_chats()
            for chat in profile_chats:
                chat["profile"] = pname
                all_chats[chat["id"]] = chat
        except Exception:
            continue
    return _list(all_chats.values())


def _find_conversation_in_profiles(
    active_profiles: list[str], conversation_id: str
) -> tuple[list[dict[str, Any]] | None, Exception | None]:
    messages = None
    last_error = None
    for pname in active_profiles:
        try:
            secure_1psid, secure_1psidts = load_cookies(pname)
            client = GeminiClient(secure_1psid, secure_1psidts)
            messages = client.fetch_chat(conversation_id)
            if messages is None:
                raise ConversationNotFoundError(
                    f"Conversation {conversation_id} not found in profile {pname}"
                )
            break
        except ConversationNotFoundError:
            continue
        except (CookieExpiredError, AuthenticationError, GeminiAPIError) as e:
            last_error = e
            continue
    return messages, last_error


def _find_client_for_conversation(
    conversation_id: str, active_profiles: list[str]
) -> tuple[str | None, str | None]:
    secure_1psid = None
    secure_1psidts = None
    for pname in active_profiles:
        try:
            pname_1psid, pname_1psidts = load_cookies(pname)
            client = GeminiClient(pname_1psid, pname_1psidts)
            messages = client.fetch_chat(conversation_id)
            if messages is None:
                raise ConversationNotFoundError(
                    f"Conversation {conversation_id} not found in profile {pname}"
                )
            secure_1psid, secure_1psidts = pname_1psid, pname_1psidts
            break
        except (
            ConversationNotFoundError,
            CookieExpiredError,
            AuthenticationError,
            GeminiAPIError,
        ):
            continue
    return secure_1psid, secure_1psidts


def _add_profile(profile_name: str) -> None:
    try:
        cookies = asyncio.run(login(profile_name))
        console.print(
            f"[bold green]Profile '{profile_name}' created with {len(cookies)} cookies.[/bold green]"
        )
    except Exception as e:
        console.print(f"[bold red]Authentication failed:[/bold red] {e}")
        sys.exit(1)


def _delete_profile(profile_name: str) -> None:
    default_name = get_default_profile_name()
    if profile_name == default_name:
        console.print("[bold yellow]Cannot delete the default profile.[/bold yellow]")
        return
    confirm = input_with_exit(f"Delete profile '{profile_name}'? (yes/no): ").strip().lower()
    if confirm == "yes":
        delete_profile(profile_name)
        console.print(f"[bold green]Profile '{profile_name}' deleted.[/bold green]")


def _rename_profile_from_id(profile_name: str, new_name: str | None = None) -> None:
    statuses = list_profile_statuses()
    console.print(_render_profiles_table(statuses, show_ids=True))
    try:
        profile_id = int(profile_name)
    except ValueError:
        console.print("[bold red]Invalid profile ID.[/bold red]")
        return
    if profile_id < 1 or profile_id > len(statuses):
        console.print("[bold red]Invalid profile ID.[/bold red]")
        return
    old_name = statuses[profile_id - 1]["name"]
    if not new_name:
        new_name = prompt_with_exit("Enter new profile name")
    rename_profile(old_name, new_name)
    console.print(f"[bold green]Profile renamed from '{old_name}' to '{new_name}'.[/bold green]")


def _set_default(profile_name: str) -> None:
    set_default_profile_name(profile_name)
    console.print(f"[bold green]Default profile set to '{profile_name}'.[/bold green]")


@click.group()
@click.option("-v", "--verbose", is_flag=True, help="Enable verbose logging")
@click.version_option(version=__version__, prog_name="gemiterm")
def cli(verbose: bool) -> None:
    setup_logging(verbose=verbose)


@cli.command()
def auth() -> None:
    profiles = list_profiles()
    if not profiles:
        console.print("[bold blue]No profiles found. Creating default profile...[/bold blue]")
        try:
            cookies = asyncio.run(login())
            console.print(
                f"[bold green]Authentication successful![/bold green]"
                f" Created 'default' profile with {len(cookies)} cookies."
            )
        except Exception as e:
            console.print(f"[bold red]Authentication failed:[/bold red] {e}")
            sys.exit(1)
        return

    statuses = list_profile_statuses()
    console.print(_render_profiles_table(statuses))
    console.print()
    console.print("[bold]Select an action:[/bold]")
    console.print("  [A] Add new profile")
    console.print("  [D] Delete profile")
    console.print("  [S] Set default")
    console.print("  [R] Rename profile")
    console.print("  [X] Exit and continue with current default")

    choice = input_with_exit("\nEnter choice (A/D/S/R/X): ").strip().upper()

    if choice == "A":
        new_name = prompt_with_exit("Enter new profile name")
        _add_profile(new_name)
    elif choice == "D":
        name_to_delete = prompt_with_exit("Enter profile name to delete")
        _delete_profile(name_to_delete)
    elif choice == "S":
        name_to_set = prompt_with_exit("Enter profile name to set as default")
        _set_default(name_to_set)
    elif choice == "R":
        statuses = list_profile_statuses()
        console.print(_render_profiles_table(statuses, show_ids=True))
        profile_id = prompt_with_exit("Enter profile ID to rename", type=int)
        if profile_id < 1 or profile_id > len(statuses):
            console.print("[bold red]Invalid profile ID.[/bold red]")
            return
        old_name = statuses[profile_id - 1]["name"]
        new_name = prompt_with_exit("Enter new profile name")
        rename_profile(old_name, new_name)
        console.print(
            f"[bold green]Profile renamed from '{old_name}' to '{new_name}'.[/bold green]"
        )
    elif choice == "X":
        default_name = get_default_profile_name()
        console.print(f"Continuing with default profile: [cyan]{default_name}[/cyan]")
    else:
        console.print("[bold red]Invalid choice.[/bold red]")


@cli.command()
@click.argument("action", type=click.Choice(["add", "delete", "rename", "default", "list"]))
@click.argument("profile_name", required=False)
@click.argument("new_name", required=False)
def profile(action: str, profile_name: str | None, new_name: str | None) -> None:
    if action == "add":
        if not profile_name:
            profile_name = prompt_with_exit("Enter new profile name")
        _add_profile(profile_name)
    elif action == "delete":
        if not profile_name:
            profile_name = prompt_with_exit("Enter profile name to delete")
        _delete_profile(profile_name)
    elif action == "rename":
        if not profile_name:
            profile_name = prompt_with_exit("Enter profile ID to rename")
        _rename_profile_from_id(profile_name, new_name)
    elif action == "default":
        if not profile_name:
            profile_name = prompt_with_exit("Enter profile name to set as default")
        _set_default(profile_name)
    elif action == "list":
        statuses = list_profile_statuses()
        if not statuses:
            console.print("[yellow]No profiles found.[/yellow]")
            return
        console.print(_render_profiles_table(statuses))


@cli.command()
@click.option("-n", "--limit", default=10, help="Number of chats to display (default: 10)")
@click.option("-o", "--offset", default=0, help="Offset for pagination")
@click.option("--all", "fetch_all", is_flag=True, help="Fetch all cached chats")
@click.option(
    "--all-profiles", "all_profiles", is_flag=True, help="Operate across all active profiles"
)
@click.option(
    "--sort",
    type=click.Choice(["recent", "oldest", "alpha"]),
    default="recent",
    help="Sort order (default: recent)",
)
@click.option("-s", "--search", default=None, help="Search chat titles")
@click.option("--after", default=None, help="Show chats after ISO date (e.g., 2024-01-01)")
@click.option("--before", default=None, help="Show chats before ISO date (e.g., 2024-01-01)")
@click.option(
    "--format", "-f", "output_format", default="text", type=click.Choice(["text", "json"])
)
@click.option(
    "--path",
    "-p",
    "output_path",
    type=click.Path(),
    default=None,
    help="File path to save list output (default: print to console)",
)
def list(
    limit: int,
    offset: int,
    fetch_all: bool,
    all_profiles: bool,
    sort: str,
    search: str | None,
    after: str | None,
    before: str | None,
    output_format: str,
    output_path: Path | None,
) -> None:
    if limit < 1:
        limit = 1

    chats: list[dict[str, Any]]

    if all_profiles:
        chats = _collect_chats_all_profiles()
    else:
        try:
            secure_1psid, secure_1psidts = load_cookies()
        except (CookieExpiredError, AuthenticationError) as e:
            handle_cli_error(e)

        try:
            client = GeminiClient(secure_1psid, secure_1psidts)
            chats = client.list_chats()
        except (CookieExpiredError, AuthenticationError, GeminiAPIError) as e:
            handle_cli_error(e)

    if not chats:
        if output_format == "json":
            console.print("[]")
        else:
            console.print("[yellow]No chats found.[/yellow]")
        return

    effective_limit = 50 if fetch_all else limit
    effective_limit = min(effective_limit, 50)

    if sort == "recent":
        chats = sorted(chats, key=lambda c: (not c.get("is_pinned", False), -c.get("timestamp", 0)))
    elif sort == "oldest":
        chats = sorted(chats, key=lambda c: (not c.get("is_pinned", False), c.get("timestamp", 0)))
    elif sort == "alpha":
        chats = sorted(
            chats, key=lambda c: (not c.get("is_pinned", False), c.get("title", "").lower())
        )

    if search:
        chats = [c for c in chats if search.lower() in c.get("title", "").lower()]

    if after:
        after_ts = parse_iso_date(after, "after")
        chats = [c for c in chats if c.get("timestamp", 0) >= after_ts]

    if before:
        before_ts = parse_iso_date(before, "before")
        chats = [c for c in chats if c.get("timestamp", 0) <= before_ts]

    if offset >= len(chats):
        console.print("[yellow]No more chats to display.[/yellow]")
        return

    paginated_chats = chats[offset : offset + effective_limit]

    if not paginated_chats:
        if output_format == "json":
            console.print("[]")
        else:
            console.print("[yellow]No chats found matching criteria.[/yellow]")
        return

    if output_path:
        output_path = Path(output_path)
        output_path.parent.mkdir(parents=True, exist_ok=True)

        if output_format == "json":
            content = json.dumps(paginated_chats, indent=2)
        else:
            lines = []
            for chat in paginated_chats:
                pin_marker = "*" if chat.get("is_pinned") else ""
                ts = chat.get("timestamp")
                date_str = datetime.fromtimestamp(ts).strftime("%Y-%m-%d %H:%M") if ts else "N/A"
                lines.append(f"{chat['id']}\t{chat['title']}\t{pin_marker}\t{date_str}")
            content = "\n".join(lines)

        output_path.write_text(content)
        console.print(f"[bold green]Saved to {output_path}[/bold green]")
    else:
        if output_format == "json":
            console.print(json.dumps(paginated_chats, indent=2))
        else:
            table = Table(title="Gemini Chats")
            table.add_column("ID", style="cyan")
            table.add_column("Title", style="green")
            table.add_column("Pinned", style="yellow")
            table.add_column("Last Updated", style="blue")
            if all_profiles:
                table.add_column("Profile", style="magenta")

            for chat in paginated_chats:
                pin_marker = "*" if chat.get("is_pinned") else ""
                ts = chat.get("timestamp")
                date_str = datetime.fromtimestamp(ts).strftime("%Y-%m-%d %H:%M") if ts else "N/A"
                row = [chat["id"], chat["title"], pin_marker, date_str]
                if all_profiles:
                    row.append(chat.get("profile", "unknown"))
                table.add_row(*row)

            console.print(table)


@cli.command()
@click.argument("conversation_id", required=False)
@click.option(
    "--format", "-f", "output_format", default="text", type=click.Choice(["text", "json"])
)
@click.option(
    "--path",
    "-p",
    "output_path",
    type=click.Path(),
    default=None,
    help="File path to save fetched content (default: print to console)",
)
@click.pass_context
def fetch(
    ctx: click.Context,
    conversation_id: str | None,
    output_format: str,
    output_path: Path | None,
) -> None:
    if conversation_id is None:
        ctx.invoke(
            cli.commands["list"],
            output_format=output_format,
            output_path=output_path,
        )
        return

    validate_conversation_id(conversation_id)

    active_profiles = require_active_profiles(list_profile_statuses())

    messages, last_error = _find_conversation_in_profiles(active_profiles, conversation_id)

    if messages is None:
        if last_error:
            console.print(f"[bold red]Failed to fetch conversation:[/bold red] {last_error}")
        else:
            console.print(f"[bold red]Conversation not found:[/bold red] {conversation_id}")
        console.print(
            "[bold yellow]Run 'gemiterm list' to see available conversations.[/bold yellow]"
        )
        sys.exit(1)

    if not messages:
        console.print(f"[yellow]No messages found for conversation {conversation_id}.[/yellow]")
        return

    if output_path:
        output_path = Path(output_path)
        output_path.parent.mkdir(parents=True, exist_ok=True)

        if output_format == "json" or output_path.suffix == ".json":
            content = json.dumps(messages, indent=2)
        else:
            lines = []
            for msg in messages:
                role = msg.get("role", "user")
                content_text = msg.get("content", "")
                lines.append(f"--- {role.upper()} ---")
                lines.append(content_text)
            content = "\n".join(lines)

        output_path.write_text(content)
        console.print(f"[bold green]Saved to {output_path}[/bold green]")
    else:
        if output_format == "json":
            console.print(json.dumps(messages, indent=2))
        else:
            for msg in messages:
                role = msg.get("role", "user")
                content = msg.get("content", "")
                console.print(
                    f"[bold {('green' if role == 'user' else 'blue')}]--- {role.upper()} ---[/]"
                )
                console.print(content)
                console.print()


@cli.command(name="continue")
@click.argument("conversation_id", required=False)
@click.argument("message", required=False)
@click.pass_context
def continue_chat(ctx: click.Context, conversation_id: str | None, message: str | None) -> None:
    if conversation_id is None:
        ctx.invoke(cli.commands["list"])
        return

    validate_conversation_id(conversation_id)

    active_profiles = require_active_profiles(list_profile_statuses())

    secure_1psid, secure_1psidts = _find_client_for_conversation(conversation_id, active_profiles)

    if secure_1psid is None:
        console.print("[bold red]Conversation not found in any active profile.[/bold red]")
        console.print(
            "[bold yellow]Run 'gemiterm list' to see available conversations.[/bold yellow]"
        )
        sys.exit(1)

    if message and message.strip():
        continue_chat_single(conversation_id, message, secure_1psid, secure_1psidts)
    else:
        continue_chat_interactive(conversation_id, secure_1psid, secure_1psidts)


def continue_chat_single(
    conversation_id: str, message: str, secure_1psid: str, secure_1psidts: str | None
) -> None:
    try:
        client = GeminiClient(secure_1psid, secure_1psidts)
        response = client.continue_chat(conversation_id, message)
        console.print(f"[bold green]Response:[/bold green] {response}")
    except ConversationNotFoundError as e:
        console.print(f"[bold red]Conversation not found:[/bold red] {e}")
        console.print(
            "[bold yellow]Run 'gemiterm list' to see available conversations.[/bold yellow]"
        )
        sys.exit(1)
    except (CookieExpiredError, AuthenticationError, GeminiAPIError) as e:
        handle_cli_error(e)


def continue_chat_interactive(
    conversation_id: str, secure_1psid: str, secure_1psidts: str | None
) -> None:
    try:
        client = GeminiClient(secure_1psid, secure_1psidts)
    except Exception as e:
        console.print(f"[bold red]Failed to initialize client:[/bold red] {e}")
        sys.exit(1)

    console.print("[bold cyan]Interactive chat session started.[/bold cyan]")
    console.print("[dim]Type your message and press Enter to send.[/dim]")
    console.print("[dim]Type /exit or press Ctrl+C to end the session.[/dim]")
    console.print()

    while True:
        try:
            user_input = input_with_exit("[bold green]>[/bold green] ")

            if user_input.strip().lower() == "/exit":
                console.print("[bold cyan]Ending chat session...[/bold cyan]")
                break

            if not user_input.strip():
                continue

            try:
                response = client.continue_chat(conversation_id, user_input)
                console.print(f"[bold blue]Response:[/bold blue] {response}")
                console.print()
            except ConversationNotFoundError as e:
                console.print(f"[bold red]Conversation not found:[/bold red] {e}")
                console.print(
                    "[bold yellow]Run 'gemiterm list' to see available conversations.[/bold yellow]"
                )
                break
            except (CookieExpiredError, AuthenticationError) as e:
                handle_cli_error(e)
            except GeminiAPIError as e:
                console.print(f"[bold red]API error:[/bold red] {e}")
                console.print("[dim]Try sending another message or /exit to quit.[/dim]")
                console.print()
        except KeyboardInterrupt:
            console.print("\n[bold yellow]Session ended by user.[/bold yellow]")
            break
        except EOFError:
            console.print("\n[bold yellow]Session ended.[/bold yellow]")
            break


@cli.command(name="new")
@click.argument("message", required=False)
@click.option(
    "--profile",
    "-p",
    "profile_name",
    type=str,
    default=None,
    help="Profile to use for the new conversation",
)
@click.pass_context
def new_chat(ctx: click.Context, message: str | None, profile_name: str | None) -> None:
    active_profiles = require_active_profiles(list_profile_statuses())

    if profile_name:
        if profile_name not in active_profiles:
            console.print(f"[bold red]Profile '{profile_name}' is not active.[/bold red]")
            console.print("[yellow]Run 'gemiterm auth' to authenticate.[/yellow]")
            sys.exit(1)
        secure_1psid, secure_1psidts = load_cookies(profile_name)
    else:
        secure_1psid, secure_1psidts = load_cookies()

    if secure_1psid is None:
        console.print("[bold red]No active profile found.[/bold red]")
        console.print("[yellow]Run 'gemiterm auth' to authenticate.[/yellow]")
        sys.exit(1)

    if message and message.strip():
        new_chat_single(message, secure_1psid, secure_1psidts)
    else:
        new_chat_interactive(secure_1psid, secure_1psidts)


def new_chat_single(message: str, secure_1psid: str, secure_1psidts: str | None) -> None:
    try:
        client = GeminiClient(secure_1psid, secure_1psidts)
        response_text, conversation_id = client.start_new_chat(message)
        console.print(f"[bold green]Response:[/bold green] {response_text}")
        console.print()
        console.print(f"[bold cyan]New conversation ID:[/bold cyan] {conversation_id}")
    except (CookieExpiredError, AuthenticationError, GeminiAPIError) as e:
        handle_cli_error(e)


def new_chat_interactive(secure_1psid: str, secure_1psidts: str | None) -> None:
    try:
        client = GeminiClient(secure_1psid, secure_1psidts)
    except Exception as e:
        console.print(f"[bold red]Failed to initialize client:[/bold red] {e}")
        sys.exit(1)

    loop = client._get_loop()
    web_client = client._ensure_client()
    chat = web_client.start_chat()

    console.print("[bold cyan]New conversation started.[/bold cyan]")
    console.print("[dim]Type your message and press Enter to send.[/dim]")
    console.print("[dim]Type /exit or press Ctrl+C to end the session.[/dim]")
    console.print()

    while True:
        try:
            user_input = input_with_exit("[bold green]>[/bold green] ")

            if user_input.strip().lower() == "/exit":
                console.print("[bold cyan]Ending chat session...[/bold cyan]")
                break

            if not user_input.strip():
                continue

            try:
                response = loop.run_until_complete(chat.send_message(user_input))
                console.print(f"[bold blue]Response:[/bold blue] {response.text}")
                console.print()
                if chat.cid:
                    console.print(f"[bold cyan]Conversation ID:[/bold cyan] {chat.cid}")
                    console.print()
            except (CookieExpiredError, AuthenticationError) as e:
                handle_cli_error(e)
            except GeminiAPIError as e:
                console.print(f"[bold red]API error:[/bold red] {e}")
                console.print("[dim]Try sending another message or /exit to quit.[/dim]")
                console.print()
        except KeyboardInterrupt:
            console.print("\n[bold yellow]Session ended by user.[/bold yellow]")
            break
        except EOFError:
            console.print("\n[bold yellow]Session ended.[/bold yellow]")
            break


@cli.command()
@click.argument("conversation_id")
@click.option("--force", is_flag=True, help="Skip confirmation prompt")
def delete(conversation_id: str, force: bool) -> None:
    validate_conversation_id(conversation_id)

    if not force:
        confirm = input_with_exit(f"Delete conversation '{conversation_id}'? (yes/no): ")
        if confirm.strip().lower() != "yes":
            console.print("[yellow]Cancelled.[/yellow]")
            return

    active_profiles = require_active_profiles(list_profile_statuses())

    secure_1psid, secure_1psidts = _find_client_for_conversation(conversation_id, active_profiles)

    if secure_1psid is None:
        console.print("[bold red]Conversation not found in any active profile.[/bold red]")
        console.print(
            "[bold yellow]Run 'gemiterm list' to see available conversations.[/bold yellow]"
        )
        sys.exit(1)

    try:
        client = GeminiClient(secure_1psid, secure_1psidts)
        client.delete_chat(conversation_id)
        console.print(f"[bold green]Deleted conversation {conversation_id}.[/bold green]")
    except (CookieExpiredError, AuthenticationError, GeminiAPIError) as e:
        handle_cli_error(e)


@cli.command()
@click.argument("conversation_id")
@click.option("-o", "--output", "output_path", type=click.Path(), help="Custom output file path")
@click.option(
    "--format",
    "-f",
    "output_format",
    default="markdown",
    type=click.Choice(["markdown", "json"]),
    help="Export format (default: markdown)",
)
@click.option(
    "--include-metadata",
    is_flag=True,
    default=False,
    help="Include full metadata in export",
)
def export(
    conversation_id: str, output_path: Path | None, output_format: str, include_metadata: bool
) -> None:
    validate_conversation_id(conversation_id)

    active_profiles = require_active_profiles(list_profile_statuses())

    messages, last_error = _find_conversation_in_profiles(active_profiles, conversation_id)

    if messages is None:
        if last_error:
            console.print(f"[bold red]Failed to fetch conversation:[/bold red] {last_error}")
        else:
            console.print(f"[bold red]Conversation not found:[/bold red] {conversation_id}")
        console.print(
            "[bold yellow]Run 'gemiterm list' to see available conversations.[/bold yellow]"
        )
        sys.exit(1)

    if not messages:
        console.print(f"[yellow]No messages found for conversation {conversation_id}.[/yellow]")
        return

    if output_path is None:
        date_str = datetime.now().strftime("%Y%m%d")
        extension = "md" if output_format == "markdown" else "json"
        default_filename = f"gemini-chat-{conversation_id}-{date_str}.{extension}"
        output_path = Path.cwd() / default_filename
    else:
        output_path = Path(output_path)

    try:
        output_path.parent.mkdir(parents=True, exist_ok=True)
    except OSError as e:
        console.print(f"[bold red]Failed to create directory:[/bold red] {e}")
        sys.exit(1)

    if output_format == "markdown":
        title = f"Conversation: {conversation_id}"
        content = format_chat_as_markdown(
            messages, title, conversation_id=conversation_id, include_metadata=include_metadata
        )
    else:
        export_data = {
            "conversation_id": conversation_id,
            "message_count": len(messages),
            "messages": messages,
        }
        if include_metadata:
            export_data["metadata"] = {
                "title": f"Conversation: {conversation_id}",
                "export_date": datetime.now().isoformat(),
            }
        content = json.dumps(export_data, indent=2)

    try:
        output_path.write_text(content)
    except OSError as e:
        console.print(f"[bold red]Failed to write file:[/bold red] {e}")
        sys.exit(1)
    console.print(f"[bold green]Exported to {output_path}[/bold green]")


@cli.command()
@click.option(
    "--output-dir",
    "-o",
    type=click.Path(),
    default=None,
    help="Directory to export conversations to (default: ./exports)",
)
@click.option(
    "--since",
    type=str,
    default=None,
    help="Export only conversations newer than this ISO date (e.g., 2024-01-01)",
)
@click.option(
    "--include-metadata",
    is_flag=True,
    default=False,
    help="Include full metadata in each export",
)
@click.option(
    "--all-profiles",
    "-a",
    "all_profiles",
    is_flag=True,
    help="Export from all active profiles",
)
def export_all(
    output_dir: Path | None, since: str | None, include_metadata: bool, all_profiles: bool
) -> None:
    if output_dir is None:
        output_dir = Path.cwd() / "exports"

    output_path = Path(output_dir)
    output_path.mkdir(parents=True, exist_ok=True)

    exported_chats: list[dict[str, str]] = []
    failed_chats: list[tuple[str, str]] = []

    all_chats: list[dict[str, Any]]

    if all_profiles:
        all_chats = _collect_chats_all_profiles()
    else:
        try:
            secure_1psid, secure_1psidts = load_cookies()
        except (CookieExpiredError, AuthenticationError) as e:
            handle_cli_error(e)

        try:
            client = GeminiClient(secure_1psid, secure_1psidts)
            all_chats = client.list_chats()
        except (CookieExpiredError, AuthenticationError, GeminiAPIError) as e:
            handle_cli_error(e)

    if not all_chats:
        console.print("[yellow]No chats found.[/yellow]")
        return

    if since:
        parse_iso_date(since, "since")

    with Progress(
        SpinnerColumn(),
        TextColumn("[progress.description]{task.description}"),
        BarColumn(),
        TaskProgressColumn(),
        console=console,
    ) as progress:
        export_task = progress.add_task("[cyan]Exporting conversations...", total=len(all_chats))

        for chat in all_chats:
            conversation_id = chat["id"]
            title = chat["title"]
            pname = chat.get("profile")

            progress.update(export_task, description=f"[cyan]Exporting: {title[:30]}...")

            try:
                if all_profiles and pname:
                    secure_1psid, secure_1psidts = load_cookies(pname)
                    client = GeminiClient(secure_1psid, secure_1psidts)
                messages = client.fetch_chat(conversation_id)
                if not messages:
                    progress.advance(export_task)
                    continue

                safe_title = "".join(c if c.isalnum() or c in " -_" else "_" for c in title)[:50]
                date_str = datetime.now().strftime("%Y%m%d")
                profile_suffix = f"-{pname}" if pname else ""
                filename = (
                    f"gemini-chat-{conversation_id}{profile_suffix}-{safe_title[:20]}-{date_str}.md"
                )
                filepath = output_path / filename

                content = format_chat_as_markdown(
                    messages,
                    title,
                    conversation_id=conversation_id,
                    include_metadata=include_metadata,
                )
                filepath.write_text(content)

                exported_chats.append(
                    {
                        "id": conversation_id,
                        "title": title,
                        "filename": filename,
                    }
                )
            except Exception as e:
                failed_chats.append((conversation_id, str(e)))

            progress.advance(export_task)

    if exported_chats:
        index_path = output_path / "_index.md"
        index_lines = ["# Exported Conversations\n"]
        index_lines.append(f"Exported: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n")
        index_lines.append(f"Total: {len(exported_chats)} conversations\n")
        index_lines.append("---\n\n")

        for chat in sorted(exported_chats, key=lambda c: c["title"].lower()):
            index_lines.append(f"- [{chat['title']}]({chat['filename']}) (ID: {chat['id']})")

        index_path.write_text("\n".join(index_lines))
        console.print(f"[bold green]Created index: {index_path}[/bold green]")

    console.print(
        f"[bold green]Exported {len(exported_chats)} conversations to {output_path}[/bold green]"
    )

    if failed_chats:
        console.print(
            f"[bold yellow]Failed to export {len(failed_chats)} conversations:[/bold yellow]"
        )
        for cid, err in failed_chats:
            console.print(f"  - {cid}: {err}")


@cli.command("install-browser", hidden=True)
def install_browser() -> None:
    """Install Playwright Chromium browser."""
    console.print("[bold cyan]Installing Chromium browser...[/bold cyan]")

    if getattr(sys, "frozen", False):
        py_cmd = shutil.which("py")
        if py_cmd:
            result = subprocess.run([py_cmd, "-3", "--version"], capture_output=True, text=True)
            if (
                result.returncode == 0
                and "Python" in result.stdout
                and "not found" not in result.stdout.lower()
            ):
                playwright_cache = Path.home() / ".cache" / "ms-playwright"
                env = os.environ.copy()
                env["PLAYWRIGHT_BROWSERS_PATH"] = str(playwright_cache)

                cmd = [py_cmd, "-3", "-m", "playwright", "install", "chromium"]
                result = subprocess.run(cmd, capture_output=True, text=True, env=env)
                if result.returncode == 0:
                    console.print("[bold green]Chromium installed successfully.[/bold green]")
                    return
                console.print(
                    f"[yellow]py -3 method failed: {result.stderr or result.stdout}[/yellow]"
                )

        playwright_cache = Path.home() / ".cache" / "ms-playwright"
        env = os.environ.copy()
        env["PLAYWRIGHT_BROWSERS_PATH"] = str(playwright_cache)

        python_exe = shutil.which("python") or shutil.which("python3")
        if python_exe:
            result = subprocess.run([python_exe, "--version"], capture_output=True, text=True)
            if result.returncode == 0:
                cmd = [python_exe, "-m", "playwright", "install", "chromium"]
                result = subprocess.run(cmd, capture_output=True, text=True, env=env)
                if result.returncode == 0:
                    console.print("[bold green]Chromium installed successfully.[/bold green]")
                    return
                console.print(
                    f"[yellow]python method failed: {result.stderr or result.stdout}[/yellow]"
                )

        console.print("[yellow]Attempting direct Chromium download...[/yellow]")
        _download_chromium_fallback()
        console.print("[bold green]Chromium installed successfully.[/bold green]")
    else:
        playwright_cache = Path.home() / ".cache" / "ms-playwright"
        env = os.environ.copy()
        env["PLAYWRIGHT_BROWSERS_PATH"] = str(playwright_cache)
        cmd = [sys.executable, "-m", "playwright", "install", "chromium"]
        result = subprocess.run(cmd, capture_output=True, text=True, env=env)
        if result.returncode != 0:
            console.print("[bold red]Failed to install Chromium:[/bold red]")
            console.print(result.stderr)
            raise click.ClickException("Chromium installation failed")
        console.print("[bold green]Chromium installed successfully.[/bold green]")


def _check_existing_browser() -> bool:
    """Check if Edge or Chrome is available as a fallback browser."""
    from pathlib import Path

    edge_paths = [
        Path("C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"),
        Path("C:/Program Files/Microsoft/Edge/Application/msedge.exe"),
        Path(os.path.expandvars("%ProgramFiles(x86)%/Microsoft/Edge/Application/msedge.exe")),
        Path(os.path.expandvars("%ProgramFiles%/Microsoft/Edge/Application/msedge.exe")),
    ]
    for edge_path in edge_paths:
        if edge_path.exists():
            console.print(f"[green]Found Edge at {edge_path}[/green]")
            return True

    chrome_paths = [
        Path("C:/Program Files/Google/Chrome/Application/chrome.exe"),
        Path(os.path.expandvars("%ProgramFiles%/Google/Chrome/Application/chrome.exe")),
        Path(os.path.expanduser("~/AppData/Local/Google/Chrome/Application/chrome.exe")),
    ]
    for chrome_path in chrome_paths:
        if chrome_path.exists():
            console.print(f"[green]Found Chrome at {chrome_path}[/green]")
            return True

    return False


def _download_chromium_fallback() -> None:
    """Download Chromium directly using PowerShell when Python is not available."""
    import zipfile
    import shutil as sh
    from pathlib import Path

    playwright_dir = Path.home() / ".cache" / "ms-playwright"
    chromium_base = playwright_dir / "chromium-1312"
    chrome_exe = chromium_base / "chrome-win" / "chrome.exe"

    if chrome_exe.exists():
        return

    if _check_existing_browser():
        console.print("[yellow]Using system Edge/Chrome instead of downloading Chromium.[/yellow]")
        return

    console.print("[cyan]No Edge or Chrome found. Downloading Chromium (~200MB)...[/cyan]")

    tmp_dir = playwright_dir / "tmp"
    tmp_dir.mkdir(parents=True, exist_ok=True)
    zip_path = tmp_dir / "chromium.zip"

    urls = [
        "https://playwright.azureedge.net/builds/chromium/1312/chrome-win.zip",
        "https://playwright.downloads.microsoft.com/download/chromium/1312/chrome-win.zip",
        "https://storage.googleapis.com/chromium-browser-snapshots/Win_x64/1312/chrome-win.zip",
    ]

    for url in urls:
        console.print(f"[cyan]Trying {url}...[/cyan]")
        ps_script = f'''
        $ProgressPreference = 'SilentlyContinue'
        [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
        Invoke-WebRequest -Uri "{url}" -OutFile "{zip_path}" -UseBasicParsing
        '''
        result = subprocess.run(
            ["powershell", "-Command", ps_script], capture_output=True, text=True, timeout=300
        )
        if result.returncode == 0:
            try:
                with zipfile.ZipFile(zip_path, "r") as zip_ref:
                    zip_ref.extractall(playwright_dir)
                sh.rmtree(tmp_dir, ignore_errors=True)
                console.print("[green]Chromium downloaded successfully.[/green]")
                return
            except Exception as e:
                console.print(f"[yellow]Extraction failed: {e}[/yellow]")
                continue

    sh.rmtree(tmp_dir, ignore_errors=True)
    raise RuntimeError("Failed to download Chromium from all sources")


@cli.command()
def status() -> None:
    from gemiterm.config import _get_config_dir

    config_dir = _get_config_dir()

    console.print("[bold]gemiterm Status[/bold]")
    console.print()
    console.print(f"Config directory: [cyan]{config_dir}[/cyan]")
    console.print()

    statuses = list_profile_statuses()
    if not statuses:
        console.print("[bold red]Status: No profiles found[/bold red]")
        console.print("[yellow]Run 'gemiterm auth' to create your first profile.[/yellow]")
        sys.exit(2)

    console.print(_render_profiles_table(statuses))
