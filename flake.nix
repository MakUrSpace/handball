{
  description = "VR Handball Engine & Web Application - A-Frame WebXR with Hand Tracking & Physics";

  inputs = {
    nixpkgs.url = "github:nixos/nixpkgs?ref=nixos-unstable";
    flake-parts.url = "github:hercules-ci/flake-parts";
  };

  outputs = inputs@{ self, nixpkgs, flake-parts, ... }:
    flake-parts.lib.mkFlake { inherit inputs; } {
      systems = [ "x86_64-linux" "aarch64-linux" "x86_64-darwin" "aarch64-darwin" ];
      perSystem = { config, self', inputs', system, ... }:
      let
        pkgs = import nixpkgs {
          inherit system;
          config = {
            allowUnfree = true;
            allowUnfreePredicate = (_: true);
          };
        };
        rustPlatform = pkgs.rustPlatform;

        handball-rs = rustPlatform.buildRustPackage {
          pname = "handball-server";
          version = "0.1.0";
          src = ./.;
          cargoLock = {
            lockFile = ./Cargo.lock;
          };
          nativeBuildInputs = [ pkgs.pkg-config ];
          buildInputs = [ pkgs.openssl ];
          doCheck = false;
        };

        handball-web-build = pkgs.writers.writeBashBin "handball-web-build" ''
          set -euo pipefail
          export PATH="${pkgs.nodejs}/bin:$PATH"
          echo "=== Building VR Handball Web Application UI via Nix ==="
          if [ ! -d "web/node_modules" ]; then
            echo "Installing web dependencies..."
            ${pkgs.nodejs}/bin/npm --prefix web install
          fi
          ${pkgs.nodejs}/bin/npm --prefix web run build
        '';

        handball-app = pkgs.writers.writeBashBin "handball-app" ''
          set -euo pipefail
          echo "Ensuring web application build..."
          ${handball-web-build}/bin/handball-web-build

          PORT="''${PORT:-8080}"
          echo "Starting VR Handball Engine Server on port $PORT..."
          exec ${pkgs.cargo}/bin/cargo run --manifest-path Cargo.toml --bin handball-server -- --port "$PORT" --web-dir ./web/dist "$@"
        '';

        handball-test = pkgs.writers.writeBashBin "handball-test-suite" ''
          set -euo pipefail
          echo "=== Running Handball Rust Workspace Cargo Tests ==="
          ${pkgs.cargo}/bin/cargo test --workspace

          echo "=== Building Web Application UI via Nix ==="
          ${handball-web-build}/bin/handball-web-build

          echo "=== Running E2E API Verification Tests ==="
          if [ -f "./tests/e2e_web_test.py" ]; then
            ${pkgs.python3}/bin/python3 ./tests/e2e_web_test.py
          fi
          echo "=== All VR Handball Tests Passed Successfully ==="
        '';

        register-ngrok = pkgs.writeShellApplication {
          name = "register-ngrok";
          runtimeInputs = [ pkgs.ngrok ];
          text = ''
            set -euo pipefail
            if [ "$#" -ne 1 ]; then
              echo "Usage: nix run .#register-ngrok -- <NGROK_AUTHTOKEN>" >&2
              exit 1
            fi
            exec ngrok config add-authtoken "$1"
          '';
        };

        handball-ngrok = pkgs.writeShellApplication {
          name = "handball-ngrok";
          runtimeInputs = [ pkgs.ngrok pkgs.tmux pkgs.cargo pkgs.nodejs ];
          text = ''
            SESSION_NAME="handball-vr"
            PORT="''${PORT:-8080}"
            DOMAIN="''${1:-harmony.ngrok.app}"

            echo "=== VR Handball Quest 3 HTTPS Tunnel Setup ==="
            echo "Local Port: $PORT"
            echo "Domain: https://$DOMAIN"

            NGROK_CMD="ngrok http $PORT --domain=$DOMAIN"

            CURRENT_PANE="$(tmux display-message -p '#{pane_id}' 2>/dev/null || true)"

            if [ -n "$CURRENT_PANE" ] || [ -n "''${TMUX:-}" ]; then
              echo "Detected active tmux pane ($CURRENT_PANE). Embedding ngrok tunnel alongside..."
              
              # Spawn side-by-side pane for ngrok in the current tmux window
              NGROK_PANE_ID="$(tmux split-window -h -P -F '#{pane_id}' "echo 'Exposing VR Handball on https://$DOMAIN -> $PORT'; $NGROK_CMD; read")"

              cleanup() {
                tmux kill-pane -t "$NGROK_PANE_ID" 2>/dev/null || true
              }
              trap cleanup EXIT INT TERM

              # Run the handball server in the current foreground pane
              cargo run --manifest-path Cargo.toml --bin handball-server -- --port "$PORT"
            else
              if tmux has-session -t "$SESSION_NAME" 2>/dev/null; then
                echo "Refreshing '$SESSION_NAME' session with latest build..."
                tmux kill-session -t "$SESSION_NAME" 2>/dev/null || true
                sleep 0.5
              fi

              echo "Starting Handball Server and ngrok HTTPS tunnel in tmux session '$SESSION_NAME'..."

              tmux new-session -d -s "$SESSION_NAME" -n "handball-server" \
                "cargo run --manifest-path Cargo.toml --bin handball-server -- --port $PORT; read"

              tmux split-window -t "$SESSION_NAME:0" -h \
                "echo 'Exposing VR Handball on https://$DOMAIN -> $PORT'; $NGROK_CMD; read"

              tmux select-layout -t "$SESSION_NAME:0" even-horizontal

              if [ -t 0 ]; then
                exec tmux attach -t "$SESSION_NAME"
              else
                echo "Session '$SESSION_NAME' is running in the background."
                echo "Attach anytime with: tmux a -t $SESSION_NAME"
              fi
            fi
          '';
        };
      in {
        packages.handball-rs = handball-rs;
        packages.web-build = handball-web-build;
        packages.default = handball-app;
        packages.tests = handball-test;
        packages.test = handball-test;
        packages.register-ngrok = register-ngrok;
        packages.handball-ngrok = handball-ngrok;

        apps.default = {
          type = "app";
          program = "${self'.packages.default}/bin/handball-app";
        };

        apps.test = {
          type = "app";
          program = "${self'.packages.tests}/bin/handball-test-suite";
        };

        apps.web-build = {
          type = "app";
          program = "${self'.packages.web-build}/bin/handball-web-build";
        };

        apps.handball-ngrok = {
          type = "app";
          program = "${self'.packages.handball-ngrok}/bin/handball-ngrok";
        };

        devShells.default = pkgs.mkShell {
          name = "handballShell";
          buildInputs = [
            pkgs.cargo
            pkgs.rustc
            pkgs.rustfmt
            pkgs.clippy
            pkgs.nodejs
            pkgs.openssl
            pkgs.pkg-config
            pkgs.ngrok
            pkgs.tmux
            pkgs.python3
          ];
          shellHook = ''
            export PROJECT_NAME="handball"
            export PS1="\[\e[1;32m\][$PROJECT_NAME]\[\e[0m\] \w \$ "
            alias web-build="nix run .#web-build"
            alias run-tests="nix run .#test"
            alias run-app="nix run ."
            alias run-ngrok="nix run .#handball-ngrok"
            echo "=================================================="
            echo " VR Handball Development Environment (Nix)"
            echo " - Start App:      run-app"
            echo " - Quest 3 HTTPS:  run-ngrok (defaults to harmony.ngrok.app)"
            echo " - Build Web:      web-build"
            echo " - Run Tests:      run-tests"
            echo "=================================================="
          '';
        };
      };
    };
}
