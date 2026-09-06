use serde::Serialize;

/// Public metadata for an A-Frame experience hosted by this server.
///
/// The registry deliberately describes both server-backed and client-only apps.
/// Adding another experience should not require adding game-specific fields to
/// the platform router.
#[derive(Clone, Debug, Serialize)]
pub struct AppDescriptor {
    pub id: &'static str,
    pub name: &'static str,
    pub description: &'static str,
    pub launch_path: &'static str,
    pub runtime: AppRuntime,
    pub input: &'static [&'static str],
}

#[derive(Clone, Copy, Debug, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum AppRuntime {
    ServerAuthoritative,
    ClientRealtime,
}

#[derive(Clone, Debug)]
pub struct AppRegistry {
    apps: Vec<AppDescriptor>,
}

impl AppRegistry {
    pub fn built_in() -> Self {
        Self {
            apps: vec![
                AppDescriptor {
                    id: "handball",
                    name: "Handball",
                    description:
                        "Four-wall WebXR handball with a server-authoritative match engine.",
                    launch_path: "/apps/handball/",
                    runtime: AppRuntime::ServerAuthoritative,
                    input: &["hand_tracking", "motion_controller", "desktop"],
                },
                AppDescriptor {
                    id: "yoga",
                    name: "Yoga",
                    description: "Continuous, pose-aware stretching among the stars.",
                    launch_path: "/apps/yoga/",
                    runtime: AppRuntime::ClientRealtime,
                    input: &["hand_tracking", "motion_controller", "desktop_preview"],
                },
            ],
        }
    }

    pub fn all(&self) -> &[AppDescriptor] {
        &self.apps
    }

    pub fn find(&self, id: &str) -> Option<&AppDescriptor> {
        self.apps.iter().find(|app| app.id == id)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashSet;

    #[test]
    fn built_in_app_ids_and_paths_are_unique() {
        let registry = AppRegistry::built_in();
        let ids = registry
            .all()
            .iter()
            .map(|app| app.id)
            .collect::<HashSet<_>>();
        let paths = registry
            .all()
            .iter()
            .map(|app| app.launch_path)
            .collect::<HashSet<_>>();

        assert_eq!(ids.len(), registry.all().len());
        assert_eq!(paths.len(), registry.all().len());
        assert!(registry.find("handball").is_some());
        assert!(registry.find("yoga").is_some());
    }
}
