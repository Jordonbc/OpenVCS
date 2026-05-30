// Copyright © 2025-2026 OpenVCS Contributors
// SPDX-License-Identifier: GPL-3.0-or-later

use super::{
    reset_host_api_state_for_tests, set_status_event_emitter, set_status_text_unchecked,
};
use std::sync::{Arc, Mutex};

#[test]
fn trims_status_text_and_emits_once() {
    reset_host_api_state_for_tests();

    let events = Arc::new(Mutex::new(Vec::<String>::new()));
    let captured = Arc::clone(&events);

    set_status_event_emitter(move |message| {
        captured.lock().expect("lock events").push(message.to_string());
    });

    set_status_text_unchecked("  ready  ");
    set_status_text_unchecked("   ");

    assert_eq!(events.lock().expect("lock events").as_slice(), &["ready".to_string()]);

    reset_host_api_state_for_tests();
}
