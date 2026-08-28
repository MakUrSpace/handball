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
          src = pkgs.lib.fileset.toSource {
            root = ./.;
            fileset = pkgs.lib.fileset.unions [
              ./Cargo.toml
              ./Cargo.lock
              ./crates
            ];
          };
          cargoLock = {
            lockFile = ./Cargo.lock;
          };
          nativeBuildInputs = [ pkgs.pkg-config ];
          buildInputs = [ pkgs.openssl ];
          doCheck = false;
        };

        handball-web = pkgs.buildNpmPackage {
          pname = "handball-web";
          version = "0.1.0";
          src = pkgs.lib.fileset.toSource {
            root = ./web;
            fileset = pkgs.lib.fileset.unions [
              ./web/package.json
              ./web/package-lock.json
              ./web/tsconfig.json
              ./web/vite.config.ts
              ./web/index.html
              ./web/src
            ];
          };
          npmDepsHash = "sha256-8c7/iYQAr+koJwY+R1VtIAm/Gvh7iCGIUoCgfe6PF4g=";
          npmDepsFetcherVersion = 2;
          makeCacheWritable = true;
          forceGitDeps = true;

          installPhase = ''
            runHook preInstall
            mkdir -p "$out"
            cp -r dist/. "$out/"
            runHook postInstall
          '';
        };

        handball-web-report = pkgs.writeShellApplication {
          name = "handball-web-build";
          text = ''
            echo "VR Handball Web UI is available at ${handball-web}"
          '';
        };

        handball-app = pkgs.writeShellApplication {
          name = "handball-app";
          text = ''
            PORT="''${PORT:-8080}"
            echo "Starting VR Handball Engine Server on port $PORT..."
            exec ${handball-rs}/bin/handball-server \
              --port "$PORT" \
              --web-dir ${handball-web} \
              "$@"
          '';
        };

        handball-test = pkgs.writeShellApplication {
          name = "handball-test-suite";
          text = ''
            PORT="''${PORT:-18080}"
            ${handball-rs}/bin/handball-server \
              --port "$PORT" \
              --web-dir ${handball-web} &
            SERVER_PID="$!"
            trap 'kill "$SERVER_PID" 2>/dev/null || true' EXIT INT TERM

            sleep 1
            ${pkgs.python3}/bin/python3 ${./tests/e2e_web_test.py} "http://127.0.0.1:$PORT"
            ${pkgs.python3}/bin/python3 ${./tests/test_physics_math.py}
            echo "=== All packaged Handball tests passed successfully ==="
          '';
        };

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
          runtimeInputs = [ pkgs.ngrok pkgs.tmux ];
          text = ''
            set -euo pipefail
            SESSION_NAME="handball-vr"
            PORT="''${PORT:-8080}"

            if [ "''${1:-}" = "--check" ]; then
              test -x ${handball-rs}/bin/handball-server
              test -f ${handball-web}/index.html
              echo "Handball ngrok closure is complete."
              echo "Server: ${handball-rs}/bin/handball-server"
              echo "Web UI: ${handball-web}"
              exit 0
            fi

            DOMAIN="''${1:-musingsole.ngrok.app}"

            echo "=== VR Handball Quest 3 HTTPS Tunnel Setup ==="
            echo "Local Port: $PORT"
            echo "Domain: https://$DOMAIN"
            echo "Web UI: ${handball-web}"

            NGROK_CMD="ngrok http $PORT --domain=$DOMAIN"
            printf -v SERVER_CMD '%q ' \
              ${handball-rs}/bin/handball-server \
              --port "$PORT" \
              --web-dir ${handball-web}

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
              ${handball-rs}/bin/handball-server \
                --port "$PORT" \
                --web-dir ${handball-web}
            else
              if tmux has-session -t "$SESSION_NAME" 2>/dev/null; then
                echo "Refreshing '$SESSION_NAME' session with latest build..."
                tmux kill-session -t "$SESSION_NAME" 2>/dev/null || true
                sleep 0.5
              fi

              echo "Starting Handball Server and ngrok HTTPS tunnel in tmux session '$SESSION_NAME'..."

              tmux new-session -d -s "$SESSION_NAME" -n "handball-server" \
                "$SERVER_CMD; read"

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
        packages.handball-web = handball-web;
        packages.web-build = handball-web;
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
          program = "${handball-web-report}/bin/handball-web-build";
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
